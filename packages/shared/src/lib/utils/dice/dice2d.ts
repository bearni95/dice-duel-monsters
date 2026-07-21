import type { Application, Container, Graphics, Texture } from 'pixi.js';

type PixiModule = typeof import('pixi.js');

// Renders the six faces of a die as a flat 2D grid on a PixiJS canvas, styled to
// match a settled face of the 3D icon die (IconDiceCanvas3D): a full-colour face
// body with a darker edge, a cream icon with a black outline, and a large
// black-outlined face value centred on top of the icon.
//
// Every preview is drawn through ONE shared Pixi renderer and handed back as its
// own extracted 2D canvas, so any number of dice can be shown without spending a
// WebGL context per die (a plain per-die Application would exhaust them fast).

// Cream icon/value tint and the black outline shared by the icon and the value.
const TINT = 0xf7f3ea;
const OUTLINE = 0x000000;

// The 3D face-plane spans, re-expressed against the face half-extent H. A settled
// 3D die relates its projection `scale` to that half-extent by H = 0.9 * scale.
const ICON_SPAN = 0.92; // icon half-height, in face half-extents
const ICON_BORDER = 0.07; // icon outline thickness, in face half-extents
const NUMBER_SPAN = 0.75; // centred face-value glyph half-height, in face half-extents

// A base glyph size the value text is authored at, then scaled down to fit; keeping
// the font/stroke ratio fixed (72 / 10) reproduces the 3D die's outline weight.
const NUMBER_FONT = 72;
const NUMBER_STROKE = 10;

function shade(color: number, f: number): number {
	const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
	const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
	const b = Math.min(255, Math.round((color & 0xff) * f));
	return (r << 16) | (g << 8) | b;
}

// Pixi anchors a Text by its layout box (ascent + descent), so glyphs with no
// descender — like digits — end up sitting visually high. This measures the string's
// actual ink bounds and returns how far (in authored font px) the ink centre lies
// below the layout-box centre, so callers can nudge the text back to true centre.
let measureCtx: CanvasRenderingContext2D | null = null;
function glyphCentreOffset(str: string, fontSize: number, fontWeight: string): number {
	if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
	if (!measureCtx) return 0;
	measureCtx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
	measureCtx.textBaseline = 'alphabetic';
	const m = measureCtx.measureText(str);
	// Box centre and ink centre, both measured downward from the baseline.
	const boxCentre = (m.fontBoundingBoxDescent - m.fontBoundingBoxAscent) / 2;
	const inkCentre = (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2;
	return inkCentre - boxCentre;
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

// Draw one styled face — coloured body, outlined icon, centred outlined value —
// into `root`, its body rect added to the shared Graphics `g`. Centre (cx, cy) and
// half-extent H are in the container's pixel space; strokeW is the body edge width.
function drawFace(
	root: Container,
	g: Graphics,
	pixi: PixiModule,
	face: {
		tex: Texture | null;
		label: string;
		baseColor: number;
		edge: number;
		cx: number;
		cy: number;
		H: number;
		strokeW: number;
	}
): void {
	const { Sprite, Text } = pixi;
	const { tex, label, baseColor, edge, cx, cy, H, strokeW } = face;

	// Face body: full colour at rest, darker edge — the light term is 1 head-on.
	g.rect(cx - H, cy - H, 2 * H, 2 * H)
		.fill(baseColor)
		.stroke({ width: strokeW, color: edge, join: 'round', alignment: 0.5 });

	// Icon scaled so its half-height is ICON_SPAN*H, wrapped in a black outline —
	// the silhouette drawn in a ring of offset copies behind the cream icon, giving
	// it the same black border the value carries.
	if (tex) {
		const scale = (2 * ICON_SPAN * H) / tex.height;
		const border = ICON_BORDER * H;
		const steps = 16;
		for (let s = 0; s < steps; s++) {
			const a = (s / steps) * Math.PI * 2;
			const outline = new Sprite(tex);
			outline.anchor.set(0.5);
			outline.scale.set(scale);
			outline.tint = OUTLINE;
			outline.position.set(cx + Math.cos(a) * border, cy + Math.sin(a) * border);
			root.addChild(outline);
		}

		const icon = new Sprite(tex);
		icon.anchor.set(0.5);
		icon.scale.set(scale);
		icon.tint = TINT;
		icon.position.set(cx, cy);
		root.addChild(icon);
	}

	// Large black-outlined face value, centred on top of the icon.
	if (label) {
		const number = new Text({
			text: label,
			style: {
				fontFamily: 'Arial, sans-serif',
				fontSize: NUMBER_FONT,
				fontWeight: '700',
				fill: TINT,
				stroke: { color: OUTLINE, width: NUMBER_STROKE, join: 'round' }
			}
		});
		number.anchor.set(0.5);
		const numberScale = (2 * NUMBER_SPAN * H) / number.height;
		// The glyph is authored at NUMBER_FONT then scaled up to fit; raise its texture
		// resolution to match, so the upscaled value stays crisp instead of blurring.
		number.resolution = Math.min(Math.max(1, Math.ceil(numberScale)), 8);
		// Nudge down so the digit's ink — not its padded box — is vertically centred.
		const centreY = cy - glyphCentreOffset(label, NUMBER_FONT, '700') * numberScale;
		number.scale.set(numberScale);
		number.position.set(cx, centreY);
		root.addChild(number);
	}
}

// Draw the six faces into a fresh Container and extract it to its own 2D canvas.
// Texture loads are awaited up front, so the build-and-extract below runs to
// completion synchronously — concurrent calls never interleave on the shared stage.
export async function renderDieFaces(opts: RenderFacesOptions): Promise<HTMLCanvasElement> {
	const { faceIcons, faceLabels, baseColor, width } = opts;
	const cols = opts.cols ?? 3;
	const gap = opts.gap ?? 4;
	const resolution = opts.resolution ?? 2;

	const pixi = await getPixi();
	const { Container, Graphics, Rectangle } = pixi;
	const app = await getApp();
	const textures = await Promise.all(faceIcons.map((url) => loadTexture(url)));

	const rows = Math.ceil(6 / cols);
	const cell = (width - (cols - 1) * gap) / cols;
	const height = rows * cell + (rows - 1) * gap;

	const root: Container = new Container();
	const g = new Graphics();
	root.addChild(g);
	const edge = shade(baseColor, 0.5);
	const strokeW = Math.max(1, cell * 0.03);
	// Inset the half-extent by the stroke so the centre-aligned outline never clips.
	const H = cell / 2 - strokeW;

	for (let i = 0; i < 6; i++) {
		const c = i % cols;
		const r = Math.floor(i / cols);
		drawFace(root, g, pixi, {
			tex: textures[i],
			label: faceLabels[i] ?? '',
			baseColor,
			edge,
			cx: c * (cell + gap) + cell / 2,
			cy: r * (cell + gap) + cell / 2,
			H,
			strokeW
		});
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

export interface RenderFaceOptions {
	// Icon URL painted on the face; '' for none.
	faceIcon: string;
	// The face's value string, drawn centred over the icon; '' for none.
	faceLabel: string;
	// Die body tint.
	baseColor: number;
	// Square output size (px) of the extracted face.
	size: number;
	// Backing-store scale; 1 keeps the PNG exactly `size`×`size`.
	resolution?: number;
}

// Render a single die face, square and full-bleed, to its own 2D canvas — the
// export path that bakes each face to a standalone full-resolution PNG.
export async function renderDieFace(opts: RenderFaceOptions): Promise<HTMLCanvasElement> {
	const { faceIcon, faceLabel, baseColor, size } = opts;
	const resolution = opts.resolution ?? 1;

	const pixi = await getPixi();
	const { Container, Graphics, Rectangle } = pixi;
	const app = await getApp();
	const tex = await loadTexture(faceIcon);

	const strokeW = Math.max(1, size * 0.03);
	const H = size / 2 - strokeW;

	const root: Container = new Container();
	const g = new Graphics();
	root.addChild(g);
	drawFace(root, g, pixi, {
		tex,
		label: faceLabel,
		baseColor,
		edge: shade(baseColor, 0.5),
		cx: size / 2,
		cy: size / 2,
		H,
		strokeW
	});

	const canvas = app.renderer.extract.canvas({
		target: root,
		frame: new Rectangle(0, 0, size, size),
		resolution
	}) as HTMLCanvasElement;

	root.destroy({ children: true, texture: false, textureSource: false });
	return canvas;
}
