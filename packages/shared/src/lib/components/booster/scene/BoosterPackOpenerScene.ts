/**
 * BoosterPackOpenerScene
 *
 * Owns the Pixi application behind the booster-opening experience.
 *
 * Flow:
 *  - load → renders the wrapper and waits for a click on it
 *  - click → flashes a slash and splits the wrapper at the click Y
 *  - the top half flies up off-screen and the bottom half flies down, both
 *    rotating as they go
 *  - the pulled cards appear stacked at the cut, then settle into a 3x3 grid
 *
 * The scene has no Svelte interop: inputs arrive through the constructor and
 * outputs leave through the callbacks, so the hosting component owns its
 * lifecycle and every button around it.
 */

import { Application, Container, Graphics, Sprite, type FederatedPointerEvent } from 'pixi.js';
import type { BoosterPack, PackPull } from '$types/booster.type';
import { cardArtUrl, loadTexture } from '$utils/booster/packTextures';
import { PackSprite } from './PackSprite';
import { RevealCardSprite } from './RevealCardSprite';

export interface BoosterPackOpenerCallbacks {
	/** Fires once the cards have settled — the point at which the pulls are the player's. */
	onOpenComplete?: () => void;
	onCardClick?: (pull: PackPull, index: number) => void;
	/**
	 * Bounds (in viewport coordinates) of the wrapper while it is still intact and
	 * cuttable, or `null` once it stops being a target. The host positions a
	 * transparent keyboard proxy over it.
	 */
	onPackBoundsChange?: (bounds: DOMRect | null) => void;
	/** Bounds of each settled card, or an empty array when there are no card targets. */
	onCardBoundsChange?: (bounds: DOMRect[]) => void;
}

type SceneState = 'loading' | 'idle' | 'cutting' | 'revealing' | 'fanned';

const PACK_ASPECT = 5 / 8; // width / height (portrait)
/** How much of the axis it is fitted against the pack takes up, leaving a margin. */
const PACK_FILL = 0.82;
const CARD_ASPECT = 1080 / 1415; // the baked card PNGs
const GRID_GAP = 12;
const GRID_COLUMNS = 3;

export class BoosterPackOpenerScene {
	readonly app: Application;
	private host: HTMLElement;
	private callbacks: BoosterPackOpenerCallbacks;
	private pack: BoosterPack;
	private coverUrl: string | null;
	private pulls: PackPull[];

	private rootLayer: Container;
	private cardLayer: Container;
	private packLayer: Container;
	private uiLayer: Container;
	private cutIndicator: Graphics;

	private packSprite: PackSprite | null = null;
	private topHalf: Sprite | null = null;
	private bottomHalf: Sprite | null = null;
	private cardSprites: RevealCardSprite[] = [];

	private state: SceneState = 'loading';
	private isDestroyed = false;
	private resizeObserver: ResizeObserver | null = null;
	// Where the cut currently sits, in pack-local pixels (0 = the wrapper's top
	// edge). Follows the mouse while hovering and is moved by `adjustCut`.
	private cutY = 0;
	// Pack-local pixels a single keyboard tap moves the cut, recomputed on resize
	// as a fraction of the wrapper's height so it paces the same at any size.
	private cutStep = 12;

	constructor(
		host: HTMLElement,
		pack: BoosterPack,
		coverUrl: string | null,
		pulls: PackPull[],
		callbacks: BoosterPackOpenerCallbacks = {}
	) {
		this.host = host;
		this.callbacks = callbacks;
		this.pack = pack;
		this.coverUrl = coverUrl;
		this.pulls = pulls;
		this.app = new Application();

		this.rootLayer = new Container();
		this.cardLayer = new Container();
		this.packLayer = new Container();
		this.uiLayer = new Container();
		this.cutIndicator = new Graphics();

		void this.init();
	}

	destroy(): void {
		this.isDestroyed = true;
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		// Drop any keyboard proxies the host was rendering for us.
		try {
			this.callbacks.onPackBoundsChange?.(null);
			this.callbacks.onCardBoundsChange?.([]);
		} catch {
			// the host may have already torn down
		}
		try {
			this.app.stage.off('pointermove', this.onPointerMove);
			this.app.stage.off('pointerdown', this.onPointerDown);
			this.app.stage.off('pointerleave', this.onPointerLeave);
		} catch {
			// the stage may already be torn down
		}

		// Teardown order matters: the halves reference the wrapper's render-texture
		// source, so they go first. `app.destroy()` walks its children in an
		// unspecified order, which would otherwise risk freeing that source while
		// something still points at it.
		this.topHalf?.destroy();
		this.bottomHalf?.destroy();
		this.topHalf = null;
		this.bottomHalf = null;

		this.packSprite?.destroy();
		this.packSprite = null;

		this.cardSprites = [];
		this.app.destroy(true, { children: true, texture: false });
	}

	/**
	 * Move the cut by `deltaPx` pack-local pixels (negative = up), clamped inside
	 * the wrapper so it can't be slid off. No-op once the wrapper is no longer
	 * cuttable.
	 */
	adjustCut(deltaPx: number): void {
		if (this.state !== 'idle' || !this.packSprite) return;
		const margin = 4;
		this.cutY = Math.max(
			margin,
			Math.min(this.packSprite.packHeight - margin, this.cutY + deltaPx)
		);
		this.redrawCutAtLocal(this.cutY);
	}

	/** Pack-local pixels a single keyboard tap should move the cut. */
	get keyboardCutStep(): number {
		return this.cutStep;
	}

	/** Cut at the position the keyboard is currently aiming at. */
	triggerCut(): void {
		if (this.state !== 'idle' || !this.packSprite) return;
		void this.performCut(this.cutY);
	}

	private async init(): Promise<void> {
		const { width, height } = this.measure();
		await this.app.init({
			width,
			height,
			backgroundAlpha: 0,
			antialias: true,
			resolution: Math.min(window.devicePixelRatio || 1, 2),
			autoDensity: true
		});

		if (this.isDestroyed) {
			this.app.destroy(true, { children: true, texture: false });
			return;
		}

		this.host.appendChild(this.app.canvas);
		this.app.canvas.style.touchAction = 'none';

		this.app.stage.addChild(this.rootLayer);
		this.rootLayer.addChild(this.cardLayer);
		this.rootLayer.addChild(this.packLayer);
		this.rootLayer.addChild(this.uiLayer);
		this.uiLayer.addChild(this.cutIndicator);

		const { packW, packH } = this.computePackDimensions(width, height);
		this.packSprite = new PackSprite({
			pack: this.pack,
			coverUrl: this.coverUrl,
			app: this.app,
			width: packW,
			height: packH
		});
		await this.packSprite.load();
		if (this.isDestroyed) return;

		this.packLayer.addChild(this.packSprite);
		this.positionPack();

		this.state = 'idle';

		// Seed the cut through the middle, so a keyboard player who presses Enter
		// straight away still gets a clean split.
		this.cutY = this.packSprite.packHeight / 2;
		this.cutStep = Math.max(6, Math.round(this.packSprite.packHeight / 24));
		this.redrawCutAtLocal(this.cutY);
		this.emitPackBounds();

		this.app.stage.eventMode = 'static';
		this.app.stage.hitArea = this.app.screen;
		this.app.stage.on('pointermove', this.onPointerMove);
		this.app.stage.on('pointerdown', this.onPointerDown);
		this.app.stage.on('pointerleave', this.onPointerLeave);

		// Warm the card art while the player decides where to cut.
		void Promise.all(this.pulls.map((pull) => loadTexture(cardArtUrl(pull.card.id))));

		if (!this.resizeObserver) {
			this.resizeObserver = new ResizeObserver(() => this.handleResize());
			this.resizeObserver.observe(this.host);
		}
	}

	private measure(): { width: number; height: number } {
		const rect = this.host.getBoundingClientRect();
		return {
			width: Math.max(320, Math.floor(rect.width || 600)),
			height: Math.max(320, Math.floor(rect.height || 600))
		};
	}

	private computePackDimensions(w: number, h: number): { packW: number; packH: number } {
		// The wrapper is contained in the canvas: it is fitted against whichever of
		// the two axes runs out first and keeps its aspect either way, so it fills a
		// tall narrow column as readily as a wide short one. Both axes are held to
		// the same fraction, so the margin around it looks the same whichever bound.
		const packH = Math.min(h * PACK_FILL, (w * PACK_FILL) / PACK_ASPECT);
		return { packW: packH * PACK_ASPECT, packH };
	}

	private positionPack(): void {
		if (!this.packSprite) return;
		this.packSprite.position.set(
			this.app.screen.width / 2 - this.packSprite.packWidth / 2,
			this.app.screen.height / 2 - this.packSprite.packHeight / 2
		);
	}

	private packBounds(): { x: number; y: number; w: number; h: number } | null {
		if (!this.packSprite) return null;
		return {
			x: this.packSprite.x,
			y: this.packSprite.y,
			w: this.packSprite.packWidth,
			h: this.packSprite.packHeight
		};
	}

	private isInsidePack(globalX: number, globalY: number): boolean {
		const b = this.packBounds();
		if (!b) return false;
		return globalX >= b.x && globalX <= b.x + b.w && globalY >= b.y && globalY <= b.y + b.h;
	}

	private onPointerMove = (e: FederatedPointerEvent): void => {
		if (this.state !== 'idle' || !this.packSprite) return;
		const inside = this.isInsidePack(e.global.x, e.global.y);
		this.app.canvas.style.cursor = inside ? 'row-resize' : 'default';
		if (inside) {
			this.cutY = e.global.y - this.packSprite.y;
			this.drawCutIndicator(e.global.y);
		} else {
			// Keep the indicator where the keyboard left it: hovering away from the
			// wrapper shouldn't erase the line a keyboard player is aiming with.
			this.redrawCutAtLocal(this.cutY);
		}
	};

	private onPointerLeave = (): void => {
		if (this.state === 'idle') this.redrawCutAtLocal(this.cutY);
		else this.cutIndicator.clear();
		this.app.canvas.style.cursor = 'default';
	};

	private onPointerDown = (e: FederatedPointerEvent): void => {
		if (this.state !== 'idle' || !this.packSprite) return;
		if (!this.isInsidePack(e.global.x, e.global.y)) return;
		this.cutY = e.global.y - this.packSprite.y;
		void this.performCut(this.cutY);
	};

	private drawCutIndicator(globalY: number): void {
		const b = this.packBounds();
		if (!b) return;
		this.cutIndicator.clear();
		// The slash line, spanning the wrapper's width with a small overshoot.
		this.cutIndicator.moveTo(b.x - 24, globalY);
		this.cutIndicator.lineTo(b.x + b.w + 24, globalY);
		this.cutIndicator.stroke({ width: 2, color: 0xfde047, alpha: 0.9 });
		// A knife tip at the left edge.
		this.cutIndicator.moveTo(b.x - 32, globalY - 7);
		this.cutIndicator.lineTo(b.x - 22, globalY);
		this.cutIndicator.lineTo(b.x - 32, globalY + 7);
		this.cutIndicator.stroke({ width: 2, color: 0xfde047, alpha: 0.9 });
	}

	private redrawCutAtLocal(localY: number): void {
		const b = this.packBounds();
		if (!b) return;
		this.drawCutIndicator(b.y + localY);
	}

	private emitPackBounds(): void {
		if (!this.callbacks.onPackBoundsChange) return;
		if (this.state !== 'idle' || !this.packSprite) {
			this.callbacks.onPackBoundsChange(null);
			return;
		}
		const canvasRect = this.app.canvas.getBoundingClientRect();
		this.callbacks.onPackBoundsChange(
			new DOMRect(
				canvasRect.left + this.packSprite.x,
				canvasRect.top + this.packSprite.y,
				this.packSprite.packWidth,
				this.packSprite.packHeight
			)
		);
	}

	private emitCardBounds(): void {
		if (!this.callbacks.onCardBoundsChange) return;
		if (this.cardSprites.length === 0) {
			this.callbacks.onCardBoundsChange([]);
			return;
		}
		const canvasRect = this.app.canvas.getBoundingClientRect();
		this.callbacks.onCardBoundsChange(
			this.cardSprites.map((sprite) => {
				// The sprites are pivoted at their centre, so `position` is that centre.
				const w = sprite.cardWidth * sprite.scale.x;
				const h = sprite.cardHeight * sprite.scale.y;
				return new DOMRect(
					canvasRect.left + sprite.position.x - w / 2,
					canvasRect.top + sprite.position.y - h / 2,
					w,
					h
				);
			})
		);
	}

	private async performCut(localY: number): Promise<void> {
		if (!this.packSprite) return;
		this.state = 'cutting';
		this.cutIndicator.clear();
		this.app.canvas.style.cursor = 'default';
		// The wrapper has stopped being a cut target — drop its keyboard proxy.
		this.emitPackBounds();

		const b = this.packBounds()!;
		const globalCutY = b.y + localY;

		await this.playSlashFlash(globalCutY, b.x, b.w);
		if (this.isDestroyed || !this.packSprite) return;

		const { top, bottom } = this.packSprite.split(localY);

		// The halves share the wrapper's RenderTexture source, so the wrapper can't
		// be destroyed yet — freeing that source would crash the next render. Hide
		// it instead and dispose it once the halves are gone.
		this.packSprite.visible = false;

		// Place the halves so they still line up with the cut, pivoting at their
		// own centres so they rotate cleanly on the way out.
		this.placeHalf(top, b.x, b.y);
		this.placeHalf(bottom, b.x, b.y + localY);

		this.packLayer.addChild(top);
		this.packLayer.addChild(bottom);
		this.topHalf = top;
		this.bottomHalf = bottom;

		const screenH = this.app.screen.height;
		const screenW = this.app.screen.width;

		const halvesPromise = Promise.all([
			this.flyAway(top, {
				dx: -screenW * 0.15,
				dy: -screenH * 0.9 - top.height,
				rot: -Math.PI * 0.5,
				duration: 780
			}),
			this.flyAway(bottom, {
				dx: screenW * 0.15,
				dy: screenH * 0.9 + bottom.height,
				rot: Math.PI * 0.5,
				duration: 780
			})
		]);

		this.state = 'revealing';
		await this.revealCards();

		await halvesPromise;
		if (this.isDestroyed) return;

		// Halves first: they hold textures pointing at the wrapper's render-texture
		// source, and the wrapper owns (and destroys) that source.
		this.topHalf?.destroy();
		this.bottomHalf?.destroy();
		this.topHalf = null;
		this.bottomHalf = null;

		if (this.packSprite) {
			this.packLayer.removeChild(this.packSprite);
			this.packSprite.destroy();
			this.packSprite = null;
		}

		this.state = 'fanned';
		this.emitCardBounds();
		this.callbacks.onOpenComplete?.();
	}

	private placeHalf(half: Sprite, originX: number, originY: number): void {
		const w = half.width;
		const h = half.height;
		half.pivot.set(w / 2, h / 2);
		half.position.set(originX + w / 2, originY + h / 2);
	}

	private playSlashFlash(globalY: number, packX: number, packW: number): Promise<void> {
		return new Promise((resolve) => {
			const flash = new Graphics();
			flash.moveTo(packX - 40, globalY);
			flash.lineTo(packX + packW + 40, globalY);
			flash.stroke({ width: 5, color: 0xffffff, alpha: 1 });
			this.uiLayer.addChild(flash);

			const start = performance.now();
			const duration = 180;
			const tick = () => {
				if (this.isDestroyed || flash.destroyed) {
					flash.destroy();
					resolve();
					return;
				}
				const t = Math.min(1, (performance.now() - start) / duration);
				flash.alpha = 1 - t;
				if (t < 1) {
					requestAnimationFrame(tick);
				} else {
					flash.destroy();
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});
	}

	private flyAway(
		sprite: Sprite,
		opts: { dx: number; dy: number; rot: number; duration: number }
	): Promise<void> {
		return new Promise((resolve) => {
			const startX = sprite.position.x;
			const startY = sprite.position.y;
			const startRot = sprite.rotation;
			const start = performance.now();
			const tick = () => {
				if (this.isDestroyed || sprite.destroyed) {
					resolve();
					return;
				}
				const t = Math.min(1, (performance.now() - start) / opts.duration);
				const e = easeInCubic(t);
				sprite.position.set(startX + opts.dx * e, startY + opts.dy * e);
				sprite.rotation = startRot + opts.rot * e;
				sprite.alpha = 1 - t * 0.3;
				if (t < 1) {
					requestAnimationFrame(tick);
				} else {
					sprite.alpha = 0;
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});
	}

	private async revealCards(): Promise<void> {
		if (this.pulls.length === 0) return;

		const centerX = this.app.screen.width / 2;
		const centerY = this.app.screen.height / 2;
		const { cardW, cardH } = this.computeGridCardSize(this.pulls.length);

		// Build the stack at the centre, where the wrapper just parted.
		for (let i = 0; i < this.pulls.length; i++) {
			const pull = this.pulls[i];
			const sprite = new RevealCardSprite({ pull, width: cardW, height: cardH });
			sprite.pivot.set(cardW / 2, cardH / 2);
			// A tiny stagger, so the stack has visible depth before it fans out.
			sprite.position.set(centerX + i * 0.7, centerY + i * 0.7);
			sprite.alpha = 0;
			sprite.scale.set(0.3);
			sprite.eventMode = 'static';
			sprite.cursor = 'pointer';

			const idx = i;
			sprite.on('pointertap', () => {
				if (this.state === 'fanned') this.callbacks.onCardClick?.(pull, idx);
			});

			this.cardLayer.addChild(sprite);
			this.cardSprites.push(sprite);
		}

		await Promise.all(this.cardSprites.map((sprite, i) => this.popIn(sprite, i * 35)));
		if (this.isDestroyed) return;

		const targets = this.computeGridTargets(centerX, centerY, cardW, cardH);
		await Promise.all(
			this.cardSprites.map((sprite, i) =>
				this.tweenSprite(sprite, targets[i], 520, i * 55, easeOutCubic)
			)
		);
	}

	private gridDims(n: number): { cols: number; rows: number } {
		const cols = Math.min(GRID_COLUMNS, Math.max(1, n));
		return { cols, rows: Math.ceil(n / cols) };
	}

	// The largest card size that lets `n` cards lay out in the grid without
	// overlapping, honouring the card art's portrait aspect ratio.
	private computeGridCardSize(n: number): { cardW: number; cardH: number } {
		const { cols, rows } = this.gridDims(n);
		const maxCardW = (this.app.screen.width * 0.92 - GRID_GAP * (cols - 1)) / cols;
		const maxCardH = (this.app.screen.height * 0.92 - GRID_GAP * (rows - 1)) / rows;
		const cardWFromH = maxCardH * CARD_ASPECT;
		return cardWFromH <= maxCardW
			? { cardW: cardWFromH, cardH: maxCardH }
			: { cardW: maxCardW, cardH: maxCardW / CARD_ASPECT };
	}

	private computeGridTargets(
		centerX: number,
		centerY: number,
		cardW: number,
		cardH: number
	): Array<{ x: number; y: number; rotation: number; scale: number }> {
		const n = this.cardSprites.length;
		if (n === 0) return [];

		const { cols, rows } = this.gridDims(n);
		const cellW = cardW + GRID_GAP;
		const cellH = cardH + GRID_GAP;
		const totalH = rows * cardH + (rows - 1) * GRID_GAP;
		const firstRowY = centerY - totalH / 2 + cardH / 2;

		const targets: Array<{ x: number; y: number; rotation: number; scale: number }> = [];
		for (let i = 0; i < n; i++) {
			const row = Math.floor(i / cols);
			const col = i % cols;
			// Centre a partial last row rather than leaving it left-aligned.
			const cardsInRow = Math.min(cols, n - row * cols);
			const rowWidth = cardsInRow * cardW + (cardsInRow - 1) * GRID_GAP;
			targets.push({
				x: centerX - rowWidth / 2 + cardW / 2 + col * cellW,
				y: firstRowY + row * cellH,
				rotation: 0,
				scale: 1
			});
		}
		return targets;
	}

	private popIn(sprite: RevealCardSprite, delayMs: number): Promise<void> {
		return new Promise((resolve) => {
			const startTime = performance.now() + delayMs;
			const duration = 260;
			const tick = () => {
				if (this.isDestroyed || sprite.destroyed) {
					resolve();
					return;
				}
				const now = performance.now();
				if (now < startTime) {
					requestAnimationFrame(tick);
					return;
				}
				const t = Math.min(1, (now - startTime) / duration);
				sprite.alpha = Math.min(1, t * 1.6);
				sprite.scale.set(0.3 + easeOutBack(t) * 0.7);
				if (t < 1) {
					requestAnimationFrame(tick);
				} else {
					sprite.alpha = 1;
					sprite.scale.set(1);
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});
	}

	private tweenSprite(
		sprite: RevealCardSprite,
		target: { x: number; y: number; rotation: number; scale: number },
		durationMs: number,
		delayMs: number,
		easing: (t: number) => number
	): Promise<void> {
		return new Promise((resolve) => {
			const startTime = performance.now() + delayMs;
			const startX = sprite.position.x;
			const startY = sprite.position.y;
			const startRot = sprite.rotation;
			const startScale = sprite.scale.x;
			const tick = () => {
				if (this.isDestroyed || sprite.destroyed) {
					resolve();
					return;
				}
				const now = performance.now();
				if (now < startTime) {
					requestAnimationFrame(tick);
					return;
				}
				const t = Math.min(1, (now - startTime) / durationMs);
				const e = easing(t);
				sprite.position.set(startX + (target.x - startX) * e, startY + (target.y - startY) * e);
				sprite.rotation = startRot + (target.rotation - startRot) * e;
				sprite.scale.set(startScale + (target.scale - startScale) * e);
				if (t < 1) {
					requestAnimationFrame(tick);
				} else {
					resolve();
				}
			};
			requestAnimationFrame(tick);
		});
	}

	private handleResize(): void {
		if (this.isDestroyed) return;
		const { width, height } = this.measure();
		this.app.renderer.resize(width, height);
		// Only reflow while idle; reflowing mid-animation would jump the sprites.
		if (this.state === 'idle' && this.packSprite) {
			// The wrapper is re-fitted to the canvas it now has, and the cut line kept
			// where it was proportionally rather than at the pixel it sat on — the pack
			// it marks is a different size.
			const previousH = this.packSprite.packHeight;
			const { packW, packH } = this.computePackDimensions(width, height);
			this.packSprite.resize(packW, packH);
			this.cutY = previousH > 0 ? (this.cutY / previousH) * packH : packH / 2;
			this.cutStep = Math.max(6, Math.round(packH / 24));

			this.positionPack();
			this.redrawCutAtLocal(this.cutY);
			this.emitPackBounds();
		} else if (this.state === 'fanned') {
			// The cards stay put; only the canvas's viewport offset moved, so
			// re-emit and let the keyboard proxies follow it.
			this.emitCardBounds();
		}
	}
}

function easeOutCubic(t: number): number {
	return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
	return t * t * t;
}

function easeOutBack(t: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
