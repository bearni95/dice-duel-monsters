import { mount, tick, unmount } from 'svelte';
import GameCard from '$components/cards/GameCard.svelte';
import type { IGameCreature } from '$adapters/creature.adapter';
import { rasterizeElement } from '$utils/dom/rasterize';

// Render a card to a PNG entirely in the browser, without the caller having to put
// a GameCard on screen. This is the single card→image producer shared by the
// /admin/print page (which shows the full-size PNG for a url-fed card id) and the
// /admin/cards grid (which renders each tile from the PNG rather than a live DOM
// card). It mounts a GameCard into an off-screen host, rasterizes it (see
// rasterizeElement) and reads the result off a canvas as a PNG data URL.
//
// GameCard sizes its text and icons in fixed pixels tuned for this width, so the
// card is always rendered at SOURCE_WIDTH and the whole bitmap is then supersampled
// up to the requested output width — that scales art, text and icons together.
const SOURCE_WIDTH = 200;

export interface CardPng {
	// A `data:image/png;base64,…` URL, usable directly as an <img> src or download.
	dataUrl: string;
	width: number;
	height: number;
	// Assets (card art, icons) that failed to inline and rendered blank. Empty on a
	// clean render. Callers persisting the PNG use this to avoid baking a card with
	// missing art.
	failedAssets: string[];
}

export interface RenderCardOptions {
	// Output pixel width of the PNG. The height follows the card's aspect ratio.
	// Defaults to 1080 (the /admin/print full-size output).
	width?: number;
	// Whether to render GameCard's in-game stat overlays. Mirrors GameCard's own
	// prop: monsters show stats, other card types (spells, traps, …) do not.
	// Defaults to true.
	showStats?: boolean;
}

// Route cross-origin asset fetches (the card-art CDN, which sends no CORS headers)
// through the dev image proxy so their bytes can be read and inlined; same-origin
// assets are fetched directly. Shared by every card render so the proxy wiring
// lives in one place.
function rewriteAssetUrl(assetUrl: string): string {
	try {
		const parsed = new URL(assetUrl, window.location.href);
		if (parsed.origin === window.location.origin) return assetUrl;
		return `/admin/print/proxy?url=${encodeURIComponent(parsed.href)}`;
	} catch {
		return assetUrl;
	}
}

// Resolve once every <img> under `el` has loaded (or errored), so the card art and
// icons are decoded before the element is snapshotted. Two guards matter because
// the host is rendered far off-screen: images marked loading="lazy" (GameCard's
// art is) would otherwise never enter the viewport and never load, so each image is
// forced eager; and a per-image timeout ensures a slow or stuck load can't hang the
// render (the rasterizer inlines art bytes via fetch regardless, so a not-yet-loaded
// DOM image is not fatal).
function waitForImages(el: HTMLElement, timeoutMs = 8000): Promise<void> {
	const images = Array.from(el.querySelectorAll('img'));
	return Promise.all(
		images.map((img) => {
			img.loading = 'eager';
			if (img.complete && img.naturalWidth) return Promise.resolve();
			return new Promise<void>((resolve) => {
				const done = () => resolve();
				img.addEventListener('load', done, { once: true });
				img.addEventListener('error', done, { once: true });
				setTimeout(done, timeoutMs);
			});
		})
	).then(() => undefined);
}

// One animation frame, so the freshly-mounted card has a settled layout to measure.
function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function renderCardToPng(
	card: IGameCreature,
	options: RenderCardOptions = {}
): Promise<CardPng> {
	if (typeof document === 'undefined') {
		throw new Error('renderCardToPng can only run in the browser');
	}

	const outputWidth = options.width ?? 1080;
	const scale = outputWidth / SOURCE_WIDTH;

	// Off-screen host: laid out (so it can be measured and its images load) but far
	// outside the viewport and invisible.
	const host = document.createElement('div');
	host.style.position = 'fixed';
	host.style.top = '0';
	host.style.left = '-99999px';
	host.style.width = `${SOURCE_WIDTH}px`;
	host.style.opacity = '0';
	host.style.pointerEvents = 'none';
	document.body.appendChild(host);

	const instance = mount(GameCard, {
		target: host,
		props: { card, showStats: options.showStats ?? true }
	});

	try {
		await tick();
		await nextFrame();

		const cardEl = (host.firstElementChild as HTMLElement | null) ?? host;
		await waitForImages(cardEl);

		const { image, failedAssets } = await rasterizeElement(cardEl, {
			scale,
			rewriteUrl: rewriteAssetUrl
		});

		const canvas = document.createElement('canvas');
		canvas.width = image.naturalWidth || Math.round(cardEl.getBoundingClientRect().width * scale);
		canvas.height = image.naturalHeight || Math.round(cardEl.getBoundingClientRect().height * scale);

		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not get a 2D canvas context');
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

		return {
			dataUrl: canvas.toDataURL('image/png'),
			width: canvas.width,
			height: canvas.height,
			failedAssets
		};
	} finally {
		unmount(instance);
		host.remove();
	}
}
