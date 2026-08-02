import { Assets, type Texture } from 'pixi.js';
import type { CardAsset } from '$components/cards/GameCard.svelte';

/**
 * Pixi textures for the booster opener, keyed by URL and kept for the lifetime
 * of the tab. Every asset is served from this app's own `static/` directory, so
 * there is no cross-origin upload to work around — `Assets.load` is enough.
 *
 * A URL that fails to load resolves to `null` rather than throwing: the opener
 * draws a plain card back in its place, the canvas equivalent of the
 * "card not found" tile `GeneratedCardImage` falls back to.
 */
const cache = new Map<string, Texture | null>();
const pending = new Map<string, Promise<Texture | null>>();

/** The baked full-card PNG a pulled card is revealed as. */
export function cardArtUrl(cardId: number): string {
	return `/cards/generated/${cardId}.png`;
}

/**
 * The art used on a pack wrapper: the card's board cutout when it has one (a
 * transparent monster that reads as pack art), else its full card PNG.
 */
export function packCoverUrl(card: CardAsset): string {
	return card.billboard ?? cardArtUrl(card.id);
}

export function loadTexture(url: string): Promise<Texture | null> {
	const cached = cache.get(url);
	if (cached !== undefined) return Promise.resolve(cached);

	const inFlight = pending.get(url);
	if (inFlight) return inFlight;

	const promise = Assets.load<Texture>(url)
		.then((texture) => {
			cache.set(url, texture ?? null);
			return texture ?? null;
		})
		.catch(() => {
			cache.set(url, null);
			return null;
		})
		.finally(() => {
			pending.delete(url);
		});

	pending.set(url, promise);
	return promise;
}

/** The texture for `url` if it has already loaded, else null. */
export function cachedTexture(url: string): Texture | null {
	return cache.get(url) ?? null;
}
