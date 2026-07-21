import { mount, tick, unmount } from 'svelte';
import GameCard from '$components/cards/GameCard.svelte';
import type { IGameCreature } from '$adapters/creature.adapter';
import { rasterizeElement } from '$utils/dom/rasterize';

// Render a card to a PNG entirely in the browser, without the caller having to put
// a GameCard on screen. This is the single card→image producer shared by the
// /print page (which shows the full-size PNG for a url-fed card id) and the
// /cards grid (which renders each tile from the PNG rather than a live DOM
// card). It mounts a GameCard into an off-screen host, rasterizes it (see
// rasterizeElement) and reads the result off a canvas as a PNG data URL.
//
// GameCard sizes its text and icons in fixed pixels tuned for this width, so the
// card is always rendered at SOURCE_WIDTH and the whole bitmap is then supersampled
// up to the requested output width — that scales art, text and icons together.
const SOURCE_WIDTH = 200;

// Every baked PNG is forced to this height (at ENFORCED_HEIGHT_BASE_WIDTH wide) so a
// row or grid of cards lines up flush regardless of each card's own content. It is
// the tallest height the current card layout produces — a monster card whose name
// wraps to two lines. Shorter cards (one-line names, non-monster cards without stat
// bars) grow their frame to match: the extra space is filled by the type texture
// that already spans the whole card, and the art — a fixed square — is untouched.
// The name is clamped to two lines, so no card can exceed this height; it is applied
// as a min-height and nothing is ever cropped.
const ENFORCED_HEIGHT = 1415;
const ENFORCED_HEIGHT_BASE_WIDTH = 1080;

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
	// Defaults to 1080 (the /print full-size output).
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
		return `/print/proxy?url=${encodeURIComponent(parsed.href)}`;
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

	// The uniform output height (scaled if a non-default width is requested) and the
	// same expressed in source pixels, applied to the card as a min-height below.
	const enforcedHeight = Math.round((ENFORCED_HEIGHT * outputWidth) / ENFORCED_HEIGHT_BASE_WIDTH);
	const enforcedSourceHeight = enforcedHeight / scale;

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

		// Grow the card frame to the enforced height before snapshotting, so every PNG
		// comes out the same size. The type texture spans the whole card, so the added
		// space fills with it; a min-height (never a max) means a taller card would be
		// shown in full rather than cropped.
		cardEl.style.minHeight = `${enforcedSourceHeight}px`;
		await nextFrame();

		const { image, failedAssets } = await rasterizeElement(cardEl, {
			scale,
			rewriteUrl: rewriteAssetUrl
		});

		const canvas = document.createElement('canvas');
		canvas.width = outputWidth;
		canvas.height = enforcedHeight;

		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not get a 2D canvas context');
		// The rasterized card is the same width and, thanks to the min-height, within a
		// rounding pixel of the same height as the canvas — so this is effectively a
		// straight blit onto the uniformly-sized output rather than a stretch.
		ctx.drawImage(
			image,
			0,
			0,
			image.naturalWidth,
			image.naturalHeight,
			0,
			0,
			canvas.width,
			canvas.height
		);

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
