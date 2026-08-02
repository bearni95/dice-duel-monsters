/**
 * RevealCardSprite
 *
 * A single revealed card in the pack-opening canvas: the baked card PNG over a
 * placeholder, ringed in its rarity colour so the good pulls read at a glance.
 * Purely visual — the scene drives every position, scale and rotation tween.
 */

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PackPull } from '$types/booster.type';
import { RARITY_COLOR } from '$utils/booster/rarityTier';
import { cachedTexture, cardArtUrl, loadTexture } from '$utils/booster/packTextures';

export interface RevealCardSpriteOptions {
	pull: PackPull;
	width: number;
	height: number;
}

const CORNER_RADIUS = 6;

export class RevealCardSprite extends Container {
	readonly pull: PackPull;
	readonly cardWidth: number;
	readonly cardHeight: number;
	private artSprite: Sprite;

	constructor(opts: RevealCardSpriteOptions) {
		super();
		this.pull = opts.pull;
		this.cardWidth = opts.width;
		this.cardHeight = opts.height;

		// A filled card shape under the art, so the card looks substantial while
		// its PNG is still loading (and stays a card if the PNG never arrives).
		const placeholder = new Graphics();
		placeholder.roundRect(0, 0, this.cardWidth, this.cardHeight, CORNER_RADIUS);
		placeholder.fill(0x1f2937);
		this.addChild(placeholder);

		this.artSprite = new Sprite(Texture.WHITE);
		this.artSprite.width = this.cardWidth;
		this.artSprite.height = this.cardHeight;
		this.artSprite.tint = 0x1f2937;
		this.addChild(this.artSprite);

		const ring = new Graphics();
		ring.roundRect(0, 0, this.cardWidth, this.cardHeight, CORNER_RADIUS);
		ring.stroke({
			width: opts.pull.rarity === 'common' ? 2 : 3,
			color: RARITY_COLOR[opts.pull.rarity],
			alpha: opts.pull.rarity === 'common' ? 0.5 : 1
		});
		this.addChild(ring);

		const url = cardArtUrl(opts.pull.card.id);
		const cached = cachedTexture(url);
		if (cached) {
			this.applyTexture(cached);
		} else {
			void loadTexture(url).then((tex) => {
				if (this.destroyed || !tex) return;
				this.applyTexture(tex);
			});
		}
	}

	private applyTexture(tex: Texture): void {
		this.artSprite.texture = tex;
		this.artSprite.width = this.cardWidth;
		this.artSprite.height = this.cardHeight;
		this.artSprite.tint = 0xffffff;
	}
}
