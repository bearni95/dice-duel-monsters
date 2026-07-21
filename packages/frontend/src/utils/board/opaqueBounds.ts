import type { Texture } from 'pixi.js';

// Tight bounding box of a texture's opaque pixels, in the texture's own
// (unscaled) coordinate space. Billboard art is padded with transparent margins,
// so the visible creature is much smaller than the image; we rasterize the
// texture to an offscreen canvas and scan the alpha channel to find the extent
// of the non-transparent pixels. The result feeds the purple summon frame so it
// hugs the creature instead of the padded image. Cached per texture source since
// the same billboard is reused for every copy of a creature.
const opaqueBoundsCache = new WeakMap<
	object,
	{ x: number; y: number; width: number; height: number }
>();

export function opaqueBounds(texture: Texture) {
	const source = texture.source;
	const cached = opaqueBoundsCache.get(source);
	if (cached) return cached;

	// Rasterize at the texture's logical size so the returned bounds are already
	// in the same space the sprite uses (independent of the source's pixel ratio).
	const w = Math.max(1, Math.round(texture.width));
	const h = Math.max(1, Math.round(texture.height));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(source.resource as CanvasImageSource, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);

	const alphaThreshold = 12; // ignore near-invisible antialiasing fringe
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}

	// Fully transparent (shouldn't happen) — fall back to the full texture.
	const bounds =
		maxX < minX
			? { x: 0, y: 0, width: w, height: h }
			: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
	opaqueBoundsCache.set(source, bounds);
	return bounds;
}
