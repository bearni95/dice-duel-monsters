import type { Application, Container, Texture } from 'pixi.js';

// Renders the six faces of a die as a flat 2D grid on a PixiJS canvas, styled to
// match a settled face of the 3D icon die (IconDiceCanvas3D): a full-colour face
// body with a darker edge, a cream-tinted icon with a black drop-shadow, and a
// top-right corner badge carrying the face value.
//
// Every preview is drawn through ONE shared Pixi renderer and handed back as its
// own extracted 2D canvas, so any number of dice can be shown without spending a
// WebGL context per die (a plain per-die Application would exhaust them fast).

// Cream icon/badge tint and drop-shadow, identical to IconDiceCanvas3D.
const TINT = 0xf7f3ea;
const SHADOW = 0x000000;
const SHADOW_ALPHA = 0.5;

// The 3D face-plane spans, re-expressed against the face half-extent H. A settled
// 3D die relates its projection `scale` to that half-extent by H = 0.9 * scale, so
// the icon die's scale-relative offsets are divided by 0.9 to read against H here.
const ICON_SPAN = 0.92; // icon half-height, in face half-extents
const SHADOW_DX = 0.055 / 0.9; // drop-shadow offset (x), in face half-extents
const SHADOW_DY = 0.069 / 0.9; // drop-shadow offset (y), in face half-extents
const LABEL_SPAN = 0.24; // badge glyph half-height, in face half-extents
const LABEL_MARGIN = 0.1; // gap from the badge to the face's top and right edges

// A base glyph size the badge text is authored at, then scaled down to fit; keeping
// the font/stroke ratio fixed (72 / 10) reproduces the 3D badge's outline weight.
const BADGE_FONT = 72;
const BADGE_STROKE = 10;

function shade(color: number, f: number): number {
	const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
	const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
	const b = Math.min(255, Math.round((color & 0xff) * f));
	return (r << 16) | (g << 8) | b;
}

// Pixi is loaded once, lazily, and shared across every preview.
let pixiPromise: Promise<typeof import('pixi.js')> | null = null;
let appPromise: Promise<Application> | null = null;

async function getPixi() {
	if (!pixiPromise) pixiPromise = import('pixi.js');
	return pixiPromise;
}

async function getApp(): Promise<Application> {
	if (appPromise) return appPromise;
	appPromise = (async () => {
		const { Application } = await getPixi();
		const app = new Application();
		await app.init({
			width: 1,
			height: 1,
			backgroundAlpha: 0,
			antialias: true,
			// Offscreen renderer only — its own canvas is never mounted; each preview
			// gets an extracted canvas instead. The ticker is idle; we render on demand.
			autoStart: false
		});
		app.ticker.stop();
		return app;
	})();
	return appPromise;
}

// Face textures are cached by URL so repeated icons (opposite faces often share one)
// and repeated dice reuse a single upload.
const textureCache = new Map<string, Promise<Texture | null>>();

async function loadTexture(url: string): Promise<Texture | null> {
	if (!url) return null;
	let entry = textureCache.get(url);
	if (!entry) {
		entry = (async () => {
			try {
				const { Assets } = await getPixi();
				return await Assets.load<Texture>(url);
			} catch {
				return null;
			}
		})();
		textureCache.set(url, entry);
	}
	return entry;
}

export interface RenderFacesOptions {
	// One icon URL per face value (index 0 => face 1 … 5 => face 6); '' for none.
	faceIcons: string[];
	// One corner-badge string per face value, same order; '' for none.
	faceLabels: string[];
	// Die body tint.
	baseColor: number;
	// CSS width (px) the grid is laid out within; height follows from the row count.
	width: number;
	// Faces per row (six faces total).
	cols?: number;
	// Gap (px) between face cells.
	gap?: number;
	// Backing-store scale, for crisp output on hi-dpi screens.
	resolution?: number;
}

// Draw the six faces into a fresh Container and extract it to its own 2D canvas.
// Texture loads are awaited up front, so the build-and-extract below runs to
// completion synchronously — concurrent calls never interleave on the shared stage.
export async function renderDieFaces(opts: RenderFacesOptions): Promise<HTMLCanvasElement> {
	const { faceIcons, faceLabels, baseColor, width } = opts;
	const cols = opts.cols ?? 3;
	const gap = opts.gap ?? 4;
	const resolution = opts.resolution ?? 2;

	const { Container, Graphics, Sprite, Text, Rectangle } = await getPixi();
	const app = await getApp();
	const textures = await Promise.all(faceIcons.map((url) => loadTexture(url)));

	const rows = Math.ceil(6 / cols);
	const cell = (width - (cols - 1) * gap) / cols;
	const height = rows * cell + (rows - 1) * gap;

	const root: Container = new Container();
	const g = new Graphics();
	root.addChild(g);
	const edge = shade(baseColor, 0.5);

	for (let i = 0; i < 6; i++) {
		const c = i % cols;
		const r = Math.floor(i / cols);
		const strokeW = Math.max(1, cell * 0.03);
		// Inset the half-extent by the stroke so the centre-aligned outline never clips.
		const H = cell / 2 - strokeW;
		const fcx = c * (cell + gap) + cell / 2;
		const fcy = r * (cell + gap) + cell / 2;

		// Face body: full colour at rest, darker edge — the light term is 1 head-on.
		g.rect(fcx - H, fcy - H, 2 * H, 2 * H)
			.fill(baseColor)
			.stroke({ width: strokeW, color: edge, join: 'round', alignment: 0.5 });

		// Icon and its drop-shadow, both scaled so the icon half-height is ICON_SPAN*H.
		const tex = textures[i];
		if (tex) {
			const scale = (2 * ICON_SPAN * H) / tex.height;
			const shadow = new Sprite(tex);
			shadow.anchor.set(0.5);
			shadow.scale.set(scale);
			shadow.tint = SHADOW;
			shadow.alpha = SHADOW_ALPHA;
			shadow.position.set(fcx + SHADOW_DX * H, fcy + SHADOW_DY * H);
			root.addChild(shadow);

			const icon = new Sprite(tex);
			icon.anchor.set(0.5);
			icon.scale.set(scale);
			icon.tint = TINT;
			icon.position.set(fcx, fcy);
			root.addChild(icon);
		}

		// Corner badge in the face's top-right, its right/top edges LABEL_MARGIN from
		// the face edge — matching IconDiceCanvas3D's positionLabel.
		const str = faceLabels[i];
		if (str) {
			const text = new Text({
				text: str,
				style: {
					fontFamily: 'Arial, sans-serif',
					fontSize: BADGE_FONT,
					fontWeight: '700',
					fill: TINT,
					stroke: { color: SHADOW, width: BADGE_STROKE, join: 'round' }
				}
			});
			text.anchor.set(0.5);
			const badgeScale = (2 * LABEL_SPAN * H) / text.height;
			const halfW = (text.width / 2) * badgeScale;
			const halfH = LABEL_SPAN * H;
			text.scale.set(badgeScale);
			// Right edge at 1 - margin; top edge at 1 - margin/2 (both in half-extents).
			text.position.set(fcx + (1 - LABEL_MARGIN) * H - halfW, fcy - (1 - LABEL_MARGIN / 2) * H + halfH);
			root.addChild(text);
		}
	}

	const canvas = app.renderer.extract.canvas({
		target: root,
		frame: new Rectangle(0, 0, width, height),
		resolution
	}) as HTMLCanvasElement;

	// The extracted canvas is a standalone bitmap; the scene graph is no longer needed.
	root.destroy({ children: true, texture: false, textureSource: false });
	return canvas;
}
