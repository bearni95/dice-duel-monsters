import {
	CUBE_VERTICES,
	CUBE_FACES,
	faceFrontQuat,
	quatFromAxisAngle,
	quatMul,
	quatNormalize,
	quatSlerp,
	rotateVec,
	type Quat,
	type Vec3
} from '$utils/dice/cube3d';
import rollDie from '$utils/dice/rollDie';
import type { Application, Container, Graphics, Text as PixiText, Matrix } from 'pixi.js';

// A pool of six-sided dice drawn as genuine 3D geometry directly inside an
// existing PixiJS scene, rather than in a canvas of its own. It renders into a
// `group` Container the caller drops onto any layer of their stage, so the same
// tumbling dice the standalone DiceCanvas3D shows can be positioned anywhere on
// the board — at a fixed corner for energy/combat rolls, or floating above a
// creature for its HP roll.
//
// A throw runs in three phases across all dice at once: `arrangeMs` easing off
// the current face, the middle `spinMs` spinning randomly, then `arrangeMs`
// easing onto the rolled face (flat, parallel to the camera, numeral upright).

const NUM = 0xf7f3ea; // numeral colour
const CAM_Z = 5;
const FOCAL = 3.6;

interface Die {
	value: number;
	cubeQ: Quat;
	startFaceQ: Quat;
	finalFaceQ: Quat;
	spinStartQ: Quat;
	spinEndQ: Quat;
	spinAxis: Vec3;
	spinAngle: number;
	cx: number; // group-space centre
	cy: number;
	scale: number; // projection scale (px per world unit)
	color: number;
	labels: PixiText[]; // numerals 1..6, index 0 => "1"
	labelHalf: Array<[number, number]>; // each glyph's unscaled half-size
}

// The pixi.js constructors the renderer needs, passed in by the host module so
// this file carries no direct pixi.js runtime import (the board already imports
// them once).
export interface PixiCtors {
	Container: new () => Container;
	Graphics: new () => Graphics;
	Text: new (opts: {
		text: string;
		style: Record<string, unknown>;
	}) => PixiText;
	Matrix: new (a: number, b: number, c: number, d: number, tx: number, ty: number) => Matrix;
}

export interface Dice3DOptions {
	app: Application;
	// The stage layer the dice group is added to (screen-space, above the board).
	layer: Container;
	pixi: PixiCtors;
	arrangeMs?: number;
	spinMs?: number;
	baseColor?: number;
	// Side length (screen px) of the square the dice grid is laid out within.
	boxSize?: number;
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function randomAxis(): Vec3 {
	const a = Math.random() * Math.PI * 2;
	const z = Math.random() * 2 - 1;
	const r = Math.sqrt(1 - z * z);
	return [r * Math.cos(a), r * Math.sin(a), z];
}

function randomQuat(): Quat {
	return quatNormalize(quatFromAxisAngle(randomAxis(), Math.random() * Math.PI * 2));
}

function shade(color: number, f: number): number {
	const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
	const gg = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
	const b = Math.min(255, Math.round((color & 0xff) * f));
	return (r << 16) | (gg << 8) | b;
}

function toColor(c?: number | string): number | null {
	if (c == null) return null;
	if (typeof c === 'number') return c;
	const n = parseInt(c.replace('#', ''), 16);
	return Number.isNaN(n) ? null : n;
}

function project(p: Vec3, cx: number, cy: number, scale: number): [number, number, number] {
	const persp = FOCAL / Math.max(CAM_Z - p[2], 0.1);
	return [cx + p[0] * persp * scale, cy - p[1] * persp * scale, persp];
}

// Dice are drawn at a constant size — up to MAX_DICE_COLS per row — rather than
// shrinking so more of them fit one row. Overflow wraps onto extra rows that stack
// upward (see roll), so the bottom row stays put and new rows grow above it.
const MAX_DICE_COLS = 4;

// Placement metrics for `count` dice inside a `size`-wide box. The cell is a fixed
// square — a quarter of the box, so four fit across — giving every die the same size
// no matter how many are thrown. `cols` is the dice in a full row, `rows` how many
// rows the count needs.
function layout(count: number, size: number): {
	cols: number;
	rows: number;
	cell: number;
	scale: number;
} {
	const n = Math.max(1, count);
	const cols = Math.min(MAX_DICE_COLS, n);
	const rows = Math.ceil(n / MAX_DICE_COLS);
	const cell = size / MAX_DICE_COLS;
	return { cols, rows, cell, scale: cell * 0.28 };
}

export class Dice3D {
	private app: Application;
	private pixi: PixiCtors;
	private group: Container;
	private g: Graphics;
	private dice: Die[] = [];
	private animating = false;
	private animStart = 0;
	private rollResolve: ((values: number[]) => void) | null = null;
	private arrangeMs: number;
	private spinMs: number;
	private baseColor: number;
	private boxSize: number;

	constructor(opts: Dice3DOptions) {
		this.app = opts.app;
		this.pixi = opts.pixi;
		this.arrangeMs = opts.arrangeMs ?? 100;
		this.spinMs = opts.spinMs ?? 300;
		this.baseColor = opts.baseColor ?? 0xd7382f;
		this.boxSize = opts.boxSize ?? 200;

		this.group = new this.pixi.Container();
		this.g = new this.pixi.Graphics();
		this.group.addChild(this.g);
		opts.layer.addChild(this.group);

		this.frame = this.frame.bind(this);
		// The board's ticker runs continuously; frame() early-returns between throws
		// so the settled pose is left composited until the next roll.
		this.app.ticker.add(this.frame);
	}

	private makeDie(
		value: number,
		cx: number,
		cy: number,
		scale: number,
		color: number,
		resting: boolean
	): Die {
		const finalFaceQ = quatNormalize(faceFrontQuat(value));
		const spinStartQ = randomQuat();
		const spinAxis = randomAxis();
		const spinAngle = (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2 * (0.5 + Math.random() * 0.6);
		const labels: PixiText[] = [];
		const labelHalf: Array<[number, number]> = [];
		for (let n = 1; n <= 6; n++) {
			const text = new this.pixi.Text({
				text: String(n),
				style: { fontFamily: 'Arial, sans-serif', fontSize: 120, fontWeight: '700', fill: NUM }
			});
			text.anchor.set(0.5);
			text.visible = false;
			labels.push(text);
			labelHalf.push([text.width / 2, text.height / 2]);
			this.group.addChild(text);
		}
		return {
			value,
			cubeQ: resting ? finalFaceQ : faceFrontQuat(1),
			startFaceQ: faceFrontQuat(1),
			finalFaceQ,
			spinStartQ,
			spinAxis,
			spinAngle,
			spinEndQ: quatNormalize(quatMul(quatFromAxisAngle(spinAxis, spinAngle), spinStartQ)),
			cx,
			cy,
			scale,
			color,
			labels,
			labelHalf
		};
	}

	private clearDice() {
		for (const die of this.dice) {
			for (const label of die.labels) {
				label.parent?.removeChild(label);
				label.destroy();
			}
		}
		this.dice = [];
	}

	// Positions a face's numeral flat on its plane by mapping the glyph's local box
	// onto the face's projected in-plane axes (an affine fit — exact when the face is
	// camera-parallel, close while it tumbles).
	private positionLabel(die: Die, face: (typeof CUBE_FACES)[number], worldQ: Quat) {
		const label = die.labels[face.value - 1];
		if (!label) return;
		const [hw, hh] = die.labelHalf[face.value - 1];
		const spanV = 0.62;
		const spanU = spanV * (hw / hh);
		const at = (u: number, v: number): [number, number] => {
			const [x, y] = project(
				rotateVec(worldQ, [
					face.normal[0] + face.right[0] * u + face.up[0] * v,
					face.normal[1] + face.right[1] * u + face.up[1] * v,
					face.normal[2] + face.right[2] * u + face.up[2] * v
				]),
				die.cx,
				die.cy,
				die.scale
			);
			return [x, y];
		};
		const [cx, cy] = at(0, 0);
		const [rx, ry] = at(spanU, 0);
		const [ux, uy] = at(0, spanV);
		label.visible = true;
		label.setFromMatrix(
			new this.pixi.Matrix((rx - cx) / hw, (ry - cy) / hw, (cx - ux) / hh, (cy - uy) / hh, cx, cy)
		);
	}

	// Builds the Graphics geometry for the current pose of every die.
	private draw() {
		this.g.clear();
		for (const die of this.dice) for (const label of die.labels) label.visible = false;

		for (const die of this.dice) {
			const worldQ = die.cubeQ;
			const rotated = CUBE_VERTICES.map((v) => rotateVec(worldQ, v));
			const edge = shade(die.color, 0.5);

			const visible = CUBE_FACES.map((face) => {
				const normal = rotateVec(worldQ, face.normal);
				const depth =
					(rotated[face.indices[0]][2] +
						rotated[face.indices[1]][2] +
						rotated[face.indices[2]][2] +
						rotated[face.indices[3]][2]) /
					4;
				return { face, normal, depth };
			})
				.filter((f) => f.normal[2] > 0.001)
				.sort((a, b) => a.depth - b.depth);

			for (const { face, normal } of visible) {
				const poly = face.indices.flatMap((i) => {
					const [x, y] = project(rotated[i], die.cx, die.cy, die.scale);
					return [x, y];
				});
				const light = Math.max(0, Math.min(1, 0.5 + 0.5 * normal[2]));
				this.g
					.poly(poly)
					.fill(shade(die.color, light))
					.stroke({ width: 2, color: edge, join: 'round', alignment: 0.5 });
				this.positionLabel(die, face, worldQ);
			}
		}
	}

	private frame() {
		if (!this.animating) return;
		const arrange = Math.max(0, Math.min(this.arrangeMs, (this.spinMs + 2 * this.arrangeMs) / 2));
		const rollMs = this.spinMs + 2 * this.arrangeMs;
		const spin = Math.max(0, rollMs - 2 * arrange);
		const e = performance.now() - this.animStart;

		for (const die of this.dice) {
			if (e < arrange) {
				die.cubeQ = quatSlerp(die.startFaceQ, die.spinStartQ, easeInOutCubic(e / arrange));
			} else if (e < arrange + spin) {
				const s = spin > 0 ? (e - arrange) / spin : 1;
				die.cubeQ = quatNormalize(
					quatMul(quatFromAxisAngle(die.spinAxis, die.spinAngle * s), die.spinStartQ)
				);
			} else if (e < rollMs) {
				die.cubeQ = quatSlerp(
					die.spinEndQ,
					die.finalFaceQ,
					easeInOutCubic((e - arrange - spin) / arrange)
				);
			}
		}

		this.draw();
		if (e >= rollMs) {
			this.animating = false;
			for (const die of this.dice) die.cubeQ = die.finalFaceQ;
			this.draw();
			const values = this.dice.map((d) => d.value);
			const resolve = this.rollResolve;
			this.rollResolve = null;
			resolve?.(values);
		}
	}

	// The projected half-height (in the layer's units) of a single settled die — how far
	// the bottom row reaches below the box centre it sits on (higher rows stack upward,
	// away from it). Lets a caller butt that bottom edge right up against nearby UI (the
	// HP roll sits just above the health bar) instead of guessing from the whole box. Die
	// size is constant, so this is independent of `count`, but it's passed for clarity.
	diceHalfExtent(count: number): number {
		const { scale } = layout(Math.max(1, count), this.boxSize);
		// A resting die is camera-parallel with its front face at z = 1; its top
		// vertices (y = 1) are the highest projected points, so the row's half-height
		// is that vertex's projected offset from the centre.
		const persp = FOCAL / (CAM_Z - 1);
		return persp * scale;
	}

	// Roll `count` dice, resolving with their face values once they settle. The box
	// is (re)positioned so its centre sits at `center` (screen-space, in the layer's
	// coordinates); an optional `color` tints just this throw.
	async roll(
		count: number,
		color?: number | string,
		center?: { x: number; y: number }
	): Promise<number[]> {
		// Resolve any in-flight throw immediately so its awaiter never hangs.
		if (this.rollResolve) {
			const resolve = this.rollResolve;
			this.rollResolve = null;
			resolve(this.dice.map((d) => d.value));
		}
		this.animating = false;
		this.clearDice();
		this.group.alpha = 1;

		const S = this.boxSize;
		if (center) this.group.position.set(center.x - S / 2, center.y - S / 2);

		if (count <= 0) {
			this.draw();
			return [];
		}

		const col = toColor(color) ?? this.baseColor;
		const { cell, scale } = layout(count, S);
		for (let i = 0; i < count; i++) {
			// Row 0 is the bottom row and fills first; overflow rows stack above it, so
			// the throw grows upward from the box centre and the bottom row stays anchored.
			const r = Math.floor(i / MAX_DICE_COLS);
			const rowStart = r * MAX_DICE_COLS;
			const rowCount = Math.min(MAX_DICE_COLS, count - rowStart);
			const c = i - rowStart;

			// Each row is centred horizontally on the box centre; the bottom row sits on
			// the box centre vertically, each higher row one cell above the last.
			const cx = S / 2 + (c - (rowCount - 1) / 2) * cell;
			const cy = S / 2 - r * cell;
			this.dice.push(this.makeDie(rollDie(6), cx, cy, scale, col, false));
		}
		this.animStart = performance.now();
		this.animating = true;
		return new Promise((res) => (this.rollResolve = res));
	}

	// Remove all dice and blank the group.
	clear() {
		this.animating = false;
		this.clearDice();
		this.g.clear();
	}

	// Fade the settled dice out over `ms`, then clear them. Used once an HP roll has
	// handed its value off to the health bar so the dice don't linger over a unit.
	fadeOut(ms = 220): Promise<void> {
		return new Promise((resolve) => {
			const start = performance.now();
			const startAlpha = this.group.alpha;
			const tick = () => {
				const t = Math.min(1, (performance.now() - start) / ms);
				this.group.alpha = startAlpha * (1 - t);
				if (t >= 1) {
					this.app.ticker.remove(tick);
					this.clear();
					this.group.alpha = 1;
					resolve();
				}
			};
			this.app.ticker.add(tick);
		});
	}
}
