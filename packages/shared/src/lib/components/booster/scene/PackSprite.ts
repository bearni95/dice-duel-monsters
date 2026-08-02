/**
 * PackSprite
 *
 * Renders a booster pack wrapper into a RenderTexture so it matches
 * BoosterPackCard.svelte 1:1 — a diagonal gold-to-slate gradient, three stacked
 * sections (top reflection / cover / bottom reflection) under a frosted overlay
 * that fades towards the cover, and a 2px black border.
 *
 * Baking the wrapper into one texture is what makes `split(y)` possible: the
 * slice animation carves that texture into a top and a bottom half.
 */

import {
	Container,
	FillGradient,
	Graphics,
	Rectangle,
	RenderTexture,
	Sprite,
	Text,
	Texture,
	type Application
} from 'pixi.js';
import type { BoosterPack } from '$types/booster.type';
import { loadTexture } from '$utils/booster/packTextures';

export interface PackSpriteOptions {
	pack: BoosterPack;
	/** Art for the wrapper's cover section; null renders the gradient alone. */
	coverUrl: string | null;
	app: Application;
	width: number;
	height: number;
}

export interface PackHalves {
	top: Sprite;
	bottom: Sprite;
}

// The wrapper is artwork rather than chrome, so its palette is baked rather than
// read from the DaisyUI theme: the pack looks the same whichever theme the page
// is rendered in, the way a printed wrapper would.
const SLATE_DEEP = 0x1d242c;
const SLATE = 0x2a333c;
const GOLD_TINT = 0x6b6142;
const FROST = 'rgba(29, 36, 44, ';

export class PackSprite extends Container {
	private app: Application;
	private pack: BoosterPack;
	private coverUrl: string | null;
	private packW: number;
	private packH: number;
	// The size the wrapper's texture was baked at. `resize` moves the displayed
	// size off it rather than re-baking — re-rendering the whole composition on
	// every resize tick would be far more work than drawing the same texture at
	// another size — so cuts have to be mapped back into these coordinates.
	private texW: number;
	private texH: number;
	private renderTex: RenderTexture | null = null;
	private mainSprite: Sprite | null = null;

	constructor(opts: PackSpriteOptions) {
		super();
		this.app = opts.app;
		this.pack = opts.pack;
		this.coverUrl = opts.coverUrl;
		this.packW = opts.width;
		this.packH = opts.height;
		this.texW = opts.width;
		this.texH = opts.height;
	}

	get packWidth(): number {
		return this.packW;
	}

	get packHeight(): number {
		return this.packH;
	}

	/**
	 * Draw the wrapper at another size. The baked texture is reused and simply
	 * drawn to the new box, so this is cheap enough to run from a resize observer;
	 * the caller keeps the aspect ratio, since nothing here does.
	 */
	resize(width: number, height: number): void {
		this.packW = width;
		this.packH = height;
		if (this.mainSprite) {
			this.mainSprite.width = width;
			this.mainSprite.height = height;
		}
	}

	async load(): Promise<void> {
		const cover = this.coverUrl ? await loadTexture(this.coverUrl) : null;

		const composition = this.buildComposition(cover);

		// Render the composition into an intermediate texture, then re-render it
		// through a rect-shaped Graphics with a texture fill so the 2px black
		// border is baked into the final texture — which is what `split()` cuts.
		const intermediate = RenderTexture.create({
			width: this.packW,
			height: this.packH,
			resolution: 1
		});
		this.app.renderer.render({ container: composition, target: intermediate });
		composition.destroy({ children: true });

		const framed = new Graphics();
		framed.rect(0, 0, this.packW, this.packH);
		framed.fill({ texture: intermediate });
		framed.rect(0, 0, this.packW, this.packH);
		framed.stroke({ width: 2, color: 0x000000, alpha: 1 });

		this.renderTex = RenderTexture.create({
			width: this.packW,
			height: this.packH,
			resolution: 1
		});
		this.app.renderer.render({ container: framed, target: this.renderTex });
		framed.destroy();
		intermediate.destroy(true);

		this.mainSprite = new Sprite(this.renderTex);
		this.mainSprite.width = this.packW;
		this.mainSprite.height = this.packH;
		this.addChild(this.mainSprite);
	}

	/**
	 * Slice the rendered wrapper into top/bottom halves at the given local y. The
	 * returned sprites have anchor (0,0) and live in this container's coordinate
	 * space — the caller places them.
	 */
	split(cutY: number): PackHalves {
		if (!this.renderTex) throw new Error('PackSprite.split called before load');
		const tex = this.renderTex;
		const py = Math.max(1, Math.min(this.packH - 1, Math.round(cutY)));

		// The cut arrives in displayed pixels; the frames that carve the texture up
		// are in the pixels it was baked at, which are only the same when the wrapper
		// has not been resized since.
		const pyTex = Math.max(1, Math.min(this.texH - 1, Math.round((py / this.packH) * this.texH)));

		const topTex = new Texture({
			source: tex.source,
			frame: new Rectangle(0, 0, this.texW, pyTex)
		});
		const bottomTex = new Texture({
			source: tex.source,
			frame: new Rectangle(0, pyTex, this.texW, this.texH - pyTex)
		});

		const top = new Sprite(topTex);
		top.width = this.packW;
		top.height = py;

		const bottom = new Sprite(bottomTex);
		bottom.width = this.packW;
		bottom.height = this.packH - py;

		return { top, bottom };
	}

	override destroy(options?: Parameters<Container['destroy']>[0]): void {
		if (this.renderTex) {
			this.renderTex.destroy(true);
			this.renderTex = null;
		}
		super.destroy(options);
	}

	private buildComposition(cover: Texture | null): Container {
		const root = new Container();
		const w = this.packW;
		const h = this.packH;

		// Three stacked sections mirroring BoosterPackCard.svelte: an aspect-[10/3]
		// reflection, an aspect-square cover, another aspect-[10/3] reflection.
		const topH = (h * 3) / 16;
		const midH = (h * 10) / 16;
		const botH = (h * 3) / 16;
		const midY = topH;
		const botY = topH + midH;

		// `bg-gradient-to-br from-warning/30 via-base-300 to-base-100`.
		// FillGradient defaults to textureSpace 'local', where coordinates are 0–1
		// across the shape's bounding box — pixel values there silently overshoot
		// and paint the start colour flat.
		const bg = new Graphics();
		bg.rect(0, 0, w, h);
		bg.fill(
			new FillGradient({
				type: 'linear',
				start: { x: 0, y: 0 },
				end: { x: 1, y: 1 },
				textureSpace: 'local',
				colorStops: [
					{ offset: 0, color: GOLD_TINT },
					{ offset: 0.5, color: SLATE_DEEP },
					{ offset: 1, color: SLATE }
				]
			})
		);
		root.addChild(bg);

		if (cover && cover.width > 0 && cover.height > 0) {
			root.addChild(this.makeCoverSection(cover, 0, w, topH, 'top', true));
			root.addChild(this.makeCoverSection(cover, midY, w, midH, 'center', false));
			root.addChild(this.makeCoverSection(cover, botY, w, botH, 'bottom', true));
		}

		// The frosted overlays: a dark tint over the outer edge of each reflection
		// that fades out at the seam with the cover, standing in for the
		// `backdrop-blur-md bg-base-100/40` + mask-image pair in the DOM pack.
		root.addChild(this.makeFrost(0, w, topH, 'out'));
		root.addChild(this.makeFrost(botY, w, botH, 'in'));

		root.addChild(this.makeLabel(w, topH));
		if (this.pack.category) root.addChild(this.makeCategory(w, botY, botH));

		return root;
	}

	private makeFrost(y: number, w: number, h: number, direction: 'in' | 'out'): Graphics {
		const opaque = `${FROST}0.55)`;
		const clear = `${FROST}0)`;
		const frost = new Graphics();
		frost.rect(0, y, w, h);
		frost.fill(
			new FillGradient({
				type: 'linear',
				start: { x: 0, y: 0 },
				end: { x: 0, y: 1 },
				textureSpace: 'local',
				colorStops:
					direction === 'out'
						? [
								{ offset: 0, color: opaque },
								{ offset: 1, color: clear }
							]
						: [
								{ offset: 0, color: clear },
								{ offset: 1, color: opaque }
							]
			})
		);
		return frost;
	}

	private makeLabel(w: number, topH: number): Text {
		const padding = Math.max(8, w * 0.04);
		const fontSize = Math.max(14, Math.round(w * 0.072));

		const label = new Text({
			text: this.pack.label.toUpperCase(),
			style: {
				fontFamily: 'sans-serif',
				fontSize,
				fontWeight: '700',
				letterSpacing: fontSize * 0.08,
				fill: 0xf2f2f2,
				stroke: { color: 0x000000, width: 2, join: 'round' },
				align: 'center',
				wordWrap: true,
				wordWrapWidth: w - padding * 2,
				dropShadow: {
					color: 0x000000,
					alpha: 0.8,
					blur: 4,
					distance: 2,
					angle: Math.PI / 2
				}
			}
		});
		label.anchor.set(0.5);
		label.position.set(w / 2, topH / 2);
		return label;
	}

	private makeCategory(w: number, y: number, h: number): Text {
		const padding = Math.max(8, w * 0.04);
		const fontSize = Math.max(9, Math.round(w * 0.032));

		const category = new Text({
			text: this.pack.category.toUpperCase(),
			style: {
				fontFamily: 'sans-serif',
				fontSize,
				fontStyle: 'italic',
				fontWeight: '600',
				letterSpacing: fontSize * 0.08,
				fill: 0xf2f2f2,
				stroke: { color: 0x000000, width: 1, join: 'round' },
				align: 'center',
				wordWrap: true,
				wordWrapWidth: w - padding * 2
			}
		});
		category.anchor.set(0.5);
		category.position.set(w / 2, y + h / 2);
		return category;
	}

	/**
	 * Draws a CSS `object-cover` slice of `cover` into a rectangle, optionally
	 * flipped vertically (the `-scale-y-100` trick the DOM pack uses for its
	 * reflections). The source is cropped through `Texture.frame`, so the sprite
	 * comes out exactly section-sized and needs no mask.
	 */
	private makeCoverSection(
		cover: Texture,
		y: number,
		w: number,
		h: number,
		align: 'top' | 'bottom' | 'center',
		flip: boolean
	): Sprite {
		const imgW = cover.width;
		const imgH = cover.height;
		// object-cover: scale so the art fully covers the section box.
		const scale = Math.max(w / imgW, h / imgH);
		const srcW = w / scale;
		const srcH = h / scale;
		const srcX = (imgW - srcW) / 2;
		let srcY: number;
		if (align === 'top') srcY = 0;
		else if (align === 'bottom') srcY = imgH - srcH;
		else srcY = (imgH - srcH) / 2;

		// Pin the frame to integer pixels inside the source's own frame —
		// fractional or out-of-range frames render blank.
		const baseFrame = cover.frame;
		const frame = new Rectangle(
			Math.max(0, Math.round(baseFrame.x + srcX)),
			Math.max(0, Math.round(baseFrame.y + srcY)),
			Math.max(1, Math.min(baseFrame.width, Math.round(srcW))),
			Math.max(1, Math.min(baseFrame.height, Math.round(srcH)))
		);

		const sprite = new Sprite(new Texture({ source: cover.source, frame }));
		sprite.setSize(w, h);
		sprite.position.set(0, y);

		if (flip) {
			sprite.scale.y = -sprite.scale.y;
			sprite.position.y = y + h;
		}

		return sprite;
	}
}
