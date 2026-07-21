<script module lang="ts">
	// One die in the collection: its six face icon URLs and the corner-badge value
	// painted on each face (index 0 => face 1 … 5 => face 6) plus an optional body
	// tint. Declared in the module script so pages can import the type alongside the
	// component.
	export interface DieSpec {
		id: string;
		faceIcons: string[];
		faceLabels: string[];
		color?: number;
	}
</script>

<script lang="ts">
	import classNames from 'classnames';
	import { onMount, onDestroy } from 'svelte';
	import {
		CUBE_VERTICES,
		CUBE_FACES,
		quatFromAxisAngle,
		quatMul,
		quatNormalize,
		rotateVec,
		type Quat,
		type Vec3
	} from '$utils/dice/cube3d';
	import type { Application, Graphics, Sprite, Texture, Text as PixiText, Matrix } from 'pixi.js';

	// A whole collection of icon dice drawn in ONE PixiJS WebGL canvas, laid out as
	// a single horizontal strip: one die per column. Every die tumbles slowly and
	// forever on its own axis and paints its per-face value badge (the same faces
	// /dice shows); nothing is interactive. Carrying per-die icons/labels/colour
	// lets any number of *different* dice share one WebGL context instead of paying
	// one context each.

	let {
		dice: specs = [] as DieSpec[],
		tileSize = 88,
		spinSpeed = 0.5,
		defaultColor = 0xd7382f
	}: {
		dice?: DieSpec[];
		// Pixel size of each square die tile (also the strip height).
		tileSize?: number;
		// Base tumble speed in radians/second; each die varies slightly around it.
		spinSpeed?: number;
		defaultColor?: number;
	} = $props();

	const TINT = 0xf7f3ea;
	const SHADOW = 0x000000;
	const SHADOW_ALPHA = 0.5;
	const SHADOW_DX = 0.055;
	const SHADOW_DY = 0.069;
	const ICON_SPAN = 0.92;
	const LABEL_SPAN = 0.24;
	const LABEL_MARGIN = 0.1;
	const CAM_Z = 5;
	const FOCAL = 3.6;

	let container: HTMLDivElement;
	let app: Application | null = null;
	let g: Graphics | null = null;
	let MatrixCtor: new (a: number, b: number, c: number, d: number, tx: number, ty: number) => Matrix;
	let SpriteCtor: typeof import('pixi.js').Sprite;
	let TextCtor: typeof import('pixi.js').Text;
	let AssetsRef: typeof import('pixi.js').Assets;
	let ready = false;

	// A single tumbling die in the strip. Carries its own sprites so dice with
	// different icons coexist in one canvas, plus the axis/speed it spins on.
	interface Cell {
		cubeQ: Quat;
		axis: Vec3;
		speed: number;
		cx: number;
		cy: number;
		scale: number;
		color: number;
		icons: Sprite[];
		shadows: Sprite[];
		iconHalf: Array<[number, number]>;
		labels: Array<PixiText | null>;
		labelHalf: Array<[number, number]>;
	}

	let cells: Cell[] = [];

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

	function project(p: Vec3, cx: number, cy: number, scale: number): [number, number, number] {
		const persp = FOCAL / Math.max(CAM_Z - p[2], 0.1);
		return [cx + p[0] * persp * scale, cy - p[1] * persp * scale, persp];
	}

	// Load (and cache) the six face textures for a die spec, in face order.
	async function loadTextures(spec: DieSpec): Promise<Texture[]> {
		return Promise.all(spec.faceIcons.map((url) => AssetsRef.load<Texture>(url)));
	}

	function makeCell(spec: DieSpec, textures: Texture[], cx: number, cy: number, scale: number): Cell {
		const color = spec.color ?? defaultColor;
		const icons: Sprite[] = [];
		const shadows: Sprite[] = [];
		const iconHalf: Array<[number, number]> = [];
		// Shadows first so every icon composites above every drop-shadow of this cell.
		for (let n = 1; n <= 6; n++) {
			const shadow = new SpriteCtor(textures[n - 1]);
			shadow.anchor.set(0.5);
			shadow.tint = SHADOW;
			shadow.alpha = SHADOW_ALPHA;
			shadow.visible = false;
			shadows.push(shadow);
			app?.stage.addChild(shadow);
		}
		for (let n = 1; n <= 6; n++) {
			const sprite = new SpriteCtor(textures[n - 1]);
			sprite.anchor.set(0.5);
			sprite.tint = TINT;
			sprite.visible = false;
			icons.push(sprite);
			iconHalf.push([sprite.width / 2, sprite.height / 2]);
			app?.stage.addChild(sprite);
		}
		const labels: Array<PixiText | null> = [];
		const labelHalf: Array<[number, number]> = [];
		for (let n = 1; n <= 6; n++) {
			const str = spec.faceLabels[n - 1];
			if (!str) {
				labels.push(null);
				labelHalf.push([1, 1]);
				continue;
			}
			const text = new TextCtor({
				text: str,
				style: {
					fontFamily: 'Arial, sans-serif',
					fontSize: 72,
					fontWeight: '700',
					fill: TINT,
					stroke: { color: SHADOW, width: 10, join: 'round' }
				}
			});
			text.anchor.set(0.5);
			text.visible = false;
			labels.push(text);
			labelHalf.push([text.width / 2, text.height / 2]);
			app?.stage.addChild(text);
		}
		return {
			cubeQ: randomQuat(),
			axis: randomAxis(),
			// ±20% jitter so neighbouring dice drift out of sync.
			speed: spinSpeed * (0.8 + Math.random() * 0.4),
			cx,
			cy,
			scale,
			color,
			icons,
			shadows,
			iconHalf,
			labels,
			labelHalf
		};
	}

	function clearCells() {
		for (const cell of cells) {
			for (const node of [...cell.shadows, ...cell.icons, ...cell.labels]) {
				if (!node) continue;
				node.parent?.removeChild(node);
				node.destroy();
			}
		}
		cells = [];
	}

	function positionIcon(cell: Cell, face: (typeof CUBE_FACES)[number], worldQ: Quat) {
		const icon = cell.icons[face.value - 1];
		const shadow = cell.shadows[face.value - 1];
		if (!icon || !MatrixCtor) return;
		const [hw, hh] = cell.iconHalf[face.value - 1];
		const spanV = ICON_SPAN;
		const spanU = spanV * (hw / hh);
		const at = (u: number, v: number): [number, number] => {
			const [x, y] = project(
				rotateVec(worldQ, [
					face.normal[0] + face.right[0] * u + face.up[0] * v,
					face.normal[1] + face.right[1] * u + face.up[1] * v,
					face.normal[2] + face.right[2] * u + face.up[2] * v
				]),
				cell.cx,
				cell.cy,
				cell.scale
			);
			return [x, y];
		};
		const [cx, cy] = at(0, 0);
		const [rx, ry] = at(spanU, 0);
		const [ux, uy] = at(0, spanV);
		const a = (rx - cx) / hw;
		const b = (ry - cy) / hw;
		const c = (cx - ux) / hh;
		const d = (cy - uy) / hh;
		if (shadow) {
			shadow.visible = true;
			shadow.setFromMatrix(
				new MatrixCtor(a, b, c, d, cx + SHADOW_DX * cell.scale, cy + SHADOW_DY * cell.scale)
			);
		}
		icon.visible = true;
		icon.setFromMatrix(new MatrixCtor(a, b, c, d, cx, cy));
	}

	function positionLabel(cell: Cell, face: (typeof CUBE_FACES)[number], worldQ: Quat) {
		const label = cell.labels[face.value - 1];
		if (!label || !MatrixCtor) return;
		const [hw, hh] = cell.labelHalf[face.value - 1];
		const spanV = LABEL_SPAN;
		const spanU = spanV * (hw / hh);
		const u0 = 1 - LABEL_MARGIN - spanU;
		const v0 = 1 - LABEL_MARGIN / 2 - spanV;
		const at = (u: number, v: number): [number, number] => {
			const [x, y] = project(
				rotateVec(worldQ, [
					face.normal[0] + face.right[0] * u + face.up[0] * v,
					face.normal[1] + face.right[1] * u + face.up[1] * v,
					face.normal[2] + face.right[2] * u + face.up[2] * v
				]),
				cell.cx,
				cell.cy,
				cell.scale
			);
			return [x, y];
		};
		const [cx, cy] = at(u0, v0);
		const [rx, ry] = at(u0 + spanU, v0);
		const [ux, uy] = at(u0, v0 + spanV);
		label.visible = true;
		label.setFromMatrix(
			new MatrixCtor((rx - cx) / hw, (ry - cy) / hw, (cx - ux) / hh, (cy - uy) / hh, cx, cy)
		);
	}

	function draw() {
		if (!g) return;
		g.clear();
		for (const cell of cells)
			for (const node of [...cell.shadows, ...cell.icons, ...cell.labels])
				if (node) node.visible = false;

		for (const cell of cells) {
			const worldQ = cell.cubeQ;
			const rotated = CUBE_VERTICES.map((v) => rotateVec(worldQ, v));
			const edge = shade(cell.color, 0.5);
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
					const [x, y] = project(rotated[i], cell.cx, cell.cy, cell.scale);
					return [x, y];
				});
				const light = Math.max(0, Math.min(1, 0.5 + 0.5 * normal[2]));
				g.poly(poly)
					.fill(shade(cell.color, light))
					.stroke({ width: 2, color: edge, join: 'round', alignment: 0.5 });
				positionIcon(cell, face, worldQ);
				positionLabel(cell, face, worldQ);
			}
		}
	}

	// Advance every die by its own slow spin and redraw. Runs forever.
	let lastTime = 0;
	function frame() {
		const now = performance.now();
		// Clamp dt so a backgrounded tab doesn't lurch the dice forward on resume.
		const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
		lastTime = now;
		if (dt > 0)
			for (const cell of cells)
				cell.cubeQ = quatNormalize(
					quatMul(quatFromAxisAngle(cell.axis, cell.speed * dt), cell.cubeQ)
				);
		draw();
	}

	// (Re)build every cell for the current specs and resize the canvas to fit.
	let buildToken = 0;
	async function rebuild() {
		if (!ready || !app) return;
		const token = ++buildToken;
		const width = Math.round(tileSize * Math.max(specs.length, 1));
		app.renderer.resize(width, tileSize);

		// Load all textures first so a slow asset never leaves half-built cells drawn.
		const textureSets = await Promise.all(specs.map(loadTextures));
		if (token !== buildToken || !app) return; // superseded by a newer rebuild

		clearCells();
		const scale = tileSize * 0.3;
		const cy = tileSize * 0.5;
		cells = specs.map((spec, i) =>
			makeCell(spec, textureSets[i], tileSize * (i + 0.5), cy, scale)
		);
		draw();
	}

	// Rebuild whenever the set of dice changes. A signature keeps unrelated reactive
	// ticks from tearing down and rebuilding the whole canvas needlessly.
	let sigKey = $derived(
		specs
			.map((s) => `${s.id}|${s.color ?? ''}|${s.faceIcons.join(',')}|${s.faceLabels.join(',')}`)
			.join(';') +
			'@' +
			tileSize
	);
	let lastSignature = '';
	$effect(() => {
		const sig = sigKey; // tracked: re-runs when the dice or tile size change
		if (!ready || sig === lastSignature) return;
		lastSignature = sig;
		rebuild();
	});

	onMount(async () => {
		const { Application, Graphics, Sprite, Text, Assets, Matrix } = await import('pixi.js');
		MatrixCtor = Matrix;
		SpriteCtor = Sprite;
		TextCtor = Text;
		AssetsRef = Assets;
		app = new Application();
		await app.init({
			width: Math.round(tileSize * Math.max(specs.length, 1)),
			height: tileSize,
			backgroundAlpha: 0,
			antialias: true,
			resolution: Math.min(window.devicePixelRatio || 1, 2),
			autoDensity: true
		});
		container.appendChild(app.canvas);
		g = new Graphics();
		app.stage.addChild(g);
		// The ticker drives the endless tumble, so it runs for the component's life.
		app.ticker.add(frame);
		ready = true;
		// Build once now and record the signature so the reactive effect doesn't
		// immediately rebuild the same set again.
		lastSignature = sigKey;
		await rebuild();
	});

	onDestroy(() => {
		app?.destroy(true, { children: true });
		app = null;
		g = null;
	});
</script>

<!-- Pixi (autoDensity) sets the canvas CSS size; the wrapper shrink-wraps it. -->
<div
	bind:this={container}
	class={classNames('inline-block leading-none')}
	role="img"
	aria-label="Your dice"
></div>
