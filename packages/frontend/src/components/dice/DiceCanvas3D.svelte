<script lang="ts">
	import classNames from 'classnames';
	import { onMount, onDestroy } from 'svelte';
	import rollDie from '$utils/dice/rollDie';
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
	import type { Application, Graphics, Text as PixiText, Matrix } from 'pixi.js';

	// One or more six-sided dice drawn as genuine 3D geometry on a PixiJS WebGL
	// canvas: each cube's vertices are rotated by a quaternion, perspective-projected
	// to 2D, and the visible faces painted far-to-near with depth shading. Each face
	// carries its numeral, transformed onto the face plane so it tumbles along.
	//
	// A throw runs in three phases across all dice at once: `arrangeMs` easing off
	// the current face, the middle `spinMs` spinning randomly, then `arrangeMs`
	// easing onto the rolled face (flat, parallel to the camera, numeral upright).

	let {
		size = 260,
		arrangeMs = 100,
		spinMs = 300,
		baseColor = 0xd7382f,
		initialValues = [] as number[],
		onReady
	}: {
		size?: number;
		arrangeMs?: number;
		spinMs?: number;
		baseColor?: number;
		initialValues?: number[];
		onReady?: () => void;
	} = $props();

	const NUM = 0xf7f3ea; // numeral colour
	const CAM_Z = 5;
	const FOCAL = 3.6;

	let container: HTMLDivElement;
	let app: Application | null = null;
	let g: Graphics | null = null;
	let MatrixCtor: new (a: number, b: number, c: number, d: number, tx: number, ty: number) => Matrix;
	let TextCtor: typeof import('pixi.js').Text;

	// Resolves once Pixi has initialised, so roll()/show() can be called immediately.
	let readyResolve: () => void;
	const readyPromise = new Promise<void>((r) => (readyResolve = r));

	interface Die {
		value: number;
		cubeQ: Quat;
		startFaceQ: Quat;
		finalFaceQ: Quat;
		spinStartQ: Quat;
		spinEndQ: Quat;
		spinAxis: Vec3;
		spinAngle: number;
		cx: number; // canvas-space centre
		cy: number;
		scale: number; // projection scale (px per world unit)
		color: number;
		labels: PixiText[]; // numerals 1..6, index 0 => "1"
		labelHalf: Array<[number, number]>; // each glyph's unscaled half-size
	}

	let dice: Die[] = [];
	let animating = false;
	let animStart = 0;
	let rollResolve: ((values: number[]) => void) | null = null;

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

	// Grid placement for `count` dice inside the square canvas.
	function layout(count: number): { cols: number; cellW: number; cellH: number; scale: number } {
		const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
		const rows = Math.max(1, Math.ceil(count / cols));
		const cellW = size / cols;
		const cellH = size / rows;
		return { cols, cellW, cellH, scale: Math.min(cellW, cellH) * 0.28 };
	}

	function makeDie(value: number, cx: number, cy: number, scale: number, color: number, resting: boolean): Die {
		const finalFaceQ = quatNormalize(faceFrontQuat(value));
		const spinStartQ = randomQuat();
		const spinAxis = randomAxis();
		const spinAngle = (Math.random() < 0.5 ? -1 : 1) * Math.PI * 2 * (0.5 + Math.random() * 0.6);
		const labels: PixiText[] = [];
		const labelHalf: Array<[number, number]> = [];
		for (let n = 1; n <= 6; n++) {
			const text = new TextCtor({
				text: String(n),
				style: { fontFamily: 'Arial, sans-serif', fontSize: 120, fontWeight: '700', fill: NUM }
			});
			text.anchor.set(0.5);
			text.visible = false;
			labels.push(text);
			labelHalf.push([text.width / 2, text.height / 2]);
			app?.stage.addChild(text);
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

	function clearDice() {
		for (const die of dice) {
			for (const label of die.labels) {
				label.parent?.removeChild(label);
				label.destroy();
			}
		}
		dice = [];
	}

	// Positions a face's numeral flat on its plane by mapping the glyph's local box
	// onto the face's projected in-plane axes (an affine fit - exact when the face is
	// camera-parallel, close while it tumbles).
	function positionLabel(die: Die, face: (typeof CUBE_FACES)[number], worldQ: Quat) {
		const label = die.labels[face.value - 1];
		if (!label || !MatrixCtor) return;
		const [hw, hh] = die.labelHalf[face.value - 1];
		// Sample the face's up axis to the glyph's height, and its right axis only to
		// the glyph's *actual* width (height-span scaled by the glyph aspect ratio),
		// so both local axes share one scale and the numeral keeps its proportions.
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
			new MatrixCtor((rx - cx) / hw, (ry - cy) / hw, (cx - ux) / hh, (cy - uy) / hh, cx, cy)
		);
	}

	// Builds the Graphics geometry for the current pose of every die. Between throws
	// the ticker is stopped, so callers must follow this with app.render().
	function draw() {
		if (!g) return;
		g.clear();
		for (const die of dice) for (const label of die.labels) label.visible = false;

		for (const die of dice) {
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
				g.poly(poly)
					.fill(shade(die.color, light))
					.stroke({ width: 2, color: edge, join: 'round', alignment: 0.5 });
				positionLabel(die, face, worldQ);
			}
		}
	}

	function frame() {
		if (!animating) return;
		const arrange = Math.max(0, Math.min(arrangeMs, (spinMs + 2 * arrangeMs) / 2));
		const rollMs = spinMs + 2 * arrangeMs;
		const spin = Math.max(0, rollMs - 2 * arrange);
		const e = performance.now() - animStart;

		for (const die of dice) {
			if (e < arrange) {
				die.cubeQ = quatSlerp(die.startFaceQ, die.spinStartQ, easeInOutCubic(e / arrange));
			} else if (e < arrange + spin) {
				const s = spin > 0 ? (e - arrange) / spin : 1;
				die.cubeQ = quatNormalize(quatMul(quatFromAxisAngle(die.spinAxis, die.spinAngle * s), die.spinStartQ));
			} else if (e < rollMs) {
				die.cubeQ = quatSlerp(die.spinEndQ, die.finalFaceQ, easeInOutCubic((e - arrange - spin) / arrange));
			}
		}

		draw(); // the running ticker composites this frame automatically
		if (e >= rollMs) {
			animating = false;
			for (const die of dice) die.cubeQ = die.finalFaceQ;
			app?.ticker.stop();
			draw();
			app?.render(); // ticker is stopped now, so composite the final pose
			const values = dice.map((d) => d.value);
			const resolve = rollResolve;
			rollResolve = null;
			resolve?.(values);
		}
	}

	// Roll `count` dice, resolving with their face values once they settle. An
	// optional colour (hex string or number) tints just this throw.
	export async function roll(count: number, color?: number | string): Promise<number[]> {
		await readyPromise;
		// Resolve any in-flight throw immediately so its awaiter never hangs.
		if (rollResolve) {
			const resolve = rollResolve;
			rollResolve = null;
			resolve(dice.map((d) => d.value));
		}
		animating = false;
		clearDice();
		if (count <= 0) {
			draw();
			app?.render();
			return [];
		}
		const col = toColor(color) ?? baseColor;
		const { cols, cellW, cellH, scale } = layout(count);
		for (let i = 0; i < count; i++) {
			const c = i % cols;
			const r = Math.floor(i / cols);
			dice.push(makeDie(rollDie(6), (c + 0.5) * cellW, (r + 0.5) * cellH, scale, col, false));
		}
		animStart = performance.now();
		animating = true;
		app?.ticker.start();
		return new Promise((res) => (rollResolve = res));
	}

	// Show dice at rest on the given values without animating (e.g. an initial pose).
	export function show(values: number[]) {
		clearDice();
		const { cols, cellW, cellH, scale } = layout(values.length);
		for (let i = 0; i < values.length; i++) {
			const c = i % cols;
			const r = Math.floor(i / cols);
			dice.push(makeDie(values[i], (c + 0.5) * cellW, (r + 0.5) * cellH, scale, baseColor, true));
		}
		draw();
		app?.render();
	}

	// Remove all dice and blank the canvas.
	export function clear() {
		animating = false;
		app?.ticker.stop();
		clearDice();
		if (g) g.clear();
		app?.render();
	}

	onMount(async () => {
		const { Application, Graphics, Text, Matrix } = await import('pixi.js');
		MatrixCtor = Matrix;
		TextCtor = Text;
		app = new Application();
		await app.init({
			width: size,
			height: size,
			backgroundAlpha: 0,
			antialias: true,
			resolution: Math.min(window.devicePixelRatio || 1, 2),
			autoDensity: true
		});
		container.appendChild(app.canvas);
		g = new Graphics();
		app.stage.addChild(g);
		app.ticker.add(frame);
		app.ticker.stop(); // idle until a roll; the pose is static between throws

		if (initialValues.length) show(initialValues);
		else app.render();

		readyResolve();
		onReady?.();
	});

	onDestroy(() => {
		app?.destroy(true, { children: true });
		app = null;
		g = null;
	});
</script>

<!-- Pixi (autoDensity) sets the canvas CSS size, so this wrapper shrink-wraps it. -->
<div bind:this={container} class={classNames('inline-block leading-none')} role="img" aria-label="3D dice"></div>
