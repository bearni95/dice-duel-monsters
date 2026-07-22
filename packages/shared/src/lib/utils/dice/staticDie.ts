import type { Container, Graphics, Sprite, Texture, Matrix } from 'pixi.js';

// Draws a die as a flat 2D isometric cube in the board's own 2:1 projection — the same
// axonometric the grid tiles and card plaques use — so it sits on the isometric ground
// as game art rather than as a perspective-rendered 3D object. A cube is a top diamond
// (its up-turned face) plus the two side faces below it (left and right), each a
// parallelogram; every face can carry a baked die-face PNG mapped flat onto its shape.
//
// The cube is drawn centred on its Container's origin; the caller positions it.

// Directory the baked face PNGs are served from (same art the collection canvas uses);
// a die's face N loads from `${FACE_SRC_BASE}/${id}-${N}.png`.
export const FACE_SRC_BASE = '/dice/generated';

// The pixi.js constructors the renderer needs, passed in by the host so this file carries
// no direct pixi.js runtime import (the board already imports them once).
export interface StaticDiePixi {
	Container: new () => Container;
	Graphics: new () => Graphics;
	Sprite: new (texture?: Texture) => Sprite;
	Matrix: new (a: number, b: number, c: number, d: number, tx: number, ty: number) => Matrix;
}

export interface StaticDieOptions {
	// The baked face art for the three visible faces (top, left, right). A missing/undefined
	// texture leaves that face a flat shaded colour.
	topTexture?: Texture | null;
	leftTexture?: Texture | null;
	rightTexture?: Texture | null;
	// Body tint used for the flat backing behind each face (and the whole face when its
	// texture is absent); falls back to a neutral red when unset or unparseable.
	color?: number | string;
	// Full width (px) of the cube's top diamond; its height follows the 2:1 iso ratio.
	size: number;
	// Vertical extent (px) of the cube's sides; defaults to half the width, which in the
	// 2:1 iso projection makes the vertical edges match the top diamond so it reads as a
	// cube rather than a tall box.
	height?: number;
}

// Per-face brightness so the cube reads as lit from the upper-left: the top face is
// full, the left face brightest of the two sides, the right face darkest.
const TOP_LIGHT = 1;
const LEFT_LIGHT = 0.72;
const RIGHT_LIGHT = 0.5;

function shade(color: number, f: number): number {
	const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
	const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
	const b = Math.min(255, Math.round((color & 0xff) * f));
	return (r << 16) | (g << 8) | b;
}

function toColor(c?: number | string): number | null {
	if (c == null) return null;
	if (typeof c === 'number') return c;
	const n = parseInt(c.replace('#', ''), 16);
	return Number.isNaN(n) ? null : n;
}

// Order a die's six face values into the three faces an isometric cube shows: the
// highest value crowns the top, the next two highest fill the left and right sides.
// Returns 1-based face indices (so the baked `<id>-<face>.png` can be located); ties
// keep the lower index, and a die with fewer than three distinct faces repeats one.
export function orderedDieFaces(values: number[]): { top: number; left: number; right: number } {
	const ranked = values
		.map((v, i) => ({ v: Number.isNaN(v) ? -Infinity : v, i: i + 1 }))
		.sort((a, b) => b.v - a.v || a.i - b.i);
	return {
		top: ranked[0]?.i ?? 1,
		left: ranked[1]?.i ?? ranked[0]?.i ?? 1,
		right: ranked[2]?.i ?? ranked[0]?.i ?? 1
	};
}

type Pt = [number, number];

// Paint one face of the cube: a shaded colour backing (which fills any sub-pixel seam and
// stands in when the die has no baked art), then — mapped onto the quad exactly once as a
// single sprite, tinted to the face's light — its baked face PNG. A sprite (rather than a
// texture-filled polygon, which would tile the art across the face) guarantees the face
// image shows one time, affine-mapped so it lies flat on the isometric face.
//
// `map` gives the three quad corners the sprite's box maps to: o = image of the texture's
// (0,0), u = image of (w,0), v = image of (0,h); the fourth corner (u + v − o) closes the
// parallelogram — which every cube face (the top rhombus and the two sides) is.
function paintFace(
	pixi: StaticDiePixi,
	group: Container,
	g: Graphics,
	quad: [Pt, Pt, Pt, Pt],
	map: { o: Pt; u: Pt; v: Pt },
	color: number,
	light: number,
	texture: Texture | null | undefined
) {
	const poly = quad.flat();
	g.poly(poly).fill(shade(color, light));
	// A subtle edge so adjacent faces stay legible.
	g.poly(poly).stroke({ width: 1, color: shade(color, 0.35), join: 'round' });

	if (!texture) return;

	const w = texture.width || 1;
	const h = texture.height || 1;
	const sprite = new pixi.Sprite(texture);
	sprite.anchor.set(0, 0);
	// Map the sprite's (0,0)-(w,h) box onto the face quad, and tint it down by the face's
	// light so the sides read darker than the top.
	sprite.tint = shade(0xffffff, light);
	sprite.setFromMatrix(
		new pixi.Matrix(
			(map.u[0] - map.o[0]) / w,
			(map.u[1] - map.o[1]) / w,
			(map.v[0] - map.o[0]) / h,
			(map.v[1] - map.o[1]) / h,
			map.o[0],
			map.o[1]
		)
	);
	group.addChild(sprite);
}

// Build a flat isometric cube as a Container centred on its own origin.
export function buildStaticDie(pixi: StaticDiePixi, opts: StaticDieOptions): Container {
	const { topTexture, leftTexture, rightTexture, color, size, height } = opts;
	const baseColor = toColor(color) ?? 0xd7382f;

	// Half-width/height of the top diamond (2:1 iso) and the cube's vertical extent.
	const hw = size / 2;
	const hh = hw / 2;
	const vh = height ?? size * 0.5;
	// Centre the whole cube (top vertex at y=-hh, lowest at y=hh+vh) on the origin.
	const yc = -(vh / 2);

	// Top diamond vertices.
	const tTop: Pt = [0, -hh + yc];
	const tRight: Pt = [hw, yc];
	const tBottom: Pt = [0, hh + yc];
	const tLeft: Pt = [-hw, yc];
	// The two lower vertices where the sides drop to (the bottom diamond's near corners).
	const bBottom: Pt = [0, hh + vh + yc];
	const bLeft: Pt = [-hw, vh + yc];
	const bRight: Pt = [hw, vh + yc];

	// All face backings share one Graphics, added first so every face's baked-art sprite
	// (added by paintFace) layers above it.
	const group = new pixi.Container();
	const g = new pixi.Graphics();
	group.addChild(g);

	// Right face first, then left, then top — the faces don't overlap, but painting the top
	// last keeps its art on top at the shared edges.
	// Right face quad: T_right → T_bottom → B_bottom → B_right. Mapping the sprite from T_right
	// (as the left face maps from its outer corner) would reflect this face — its outer corner
	// sits on the opposite side — so its baked art would render horizontally mirrored. Anchor the
	// map at T_bottom instead so the image runs (0,0)→T_bottom, (w,0)→T_right, (0,h)→B_bottom,
	// giving the same handedness as the left and top faces (positive-determinant affine).
	paintFace(
		pixi,
		group,
		g,
		[tRight, tBottom, bBottom, bRight],
		{ o: tBottom, u: tRight, v: bBottom },
		baseColor,
		RIGHT_LIGHT,
		rightTexture
	);
	// Left face quad: T_left → T_bottom → B_bottom → B_left, textured top-left = T_left.
	paintFace(
		pixi,
		group,
		g,
		[tLeft, tBottom, bBottom, bLeft],
		{ o: tLeft, u: tBottom, v: bLeft },
		baseColor,
		LEFT_LIGHT,
		leftTexture
	);
	// Top face rhombus: textured with (0,0)→T_left, (w,0)→T_top, (0,h)→T_bottom.
	paintFace(
		pixi,
		group,
		g,
		[tTop, tRight, tBottom, tLeft],
		{ o: tLeft, u: tTop, v: tBottom },
		baseColor,
		TOP_LIGHT,
		topTexture
	);

	return group;
}
