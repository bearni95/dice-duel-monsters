<script module lang="ts">
	// One die in the collection. The six faces are drawn from the die's baked PNGs
	// (`/dice/generated/<id>-<face>.png`, exported by the admin /dice page), so a die
	// is identified by its id alone; the optional body tint only shades the backing
	// polygon behind each textured face. Declared in the module script so pages can
	// import the type alongside the component.
	export interface DieSpec {
		id: string;
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
	import type { Application, Graphics, Sprite, Texture, Matrix } from 'pixi.js';

	// A whole collection of icon dice drawn in ONE PixiJS WebGL canvas, laid out as
	// a single horizontal strip: one die per column. Every die tumbles slowly and
	// forever on its own axis, each of its six faces textured with the die's baked
	// face PNG (the same art /dice exports); nothing is interactive. Carrying per-die
	// ids/colour lets any number of *different* dice share one WebGL context instead
	// of paying one context each.

	let {
		dice: specs = [] as DieSpec[],
		tileSize = 88,
		spinSpeed = 0.5,
		defaultColor = 0xd7382f,
		faceSrcBase = '/dice/generated'
	}: {
		dice?: DieSpec[];
		// Pixel size of each square die tile (also the strip height).
		tileSize?: number;
		// Base tumble speed in radians/second; each die varies slightly around it.
		spinSpeed?: number;
		defaultColor?: number;
		// Directory the baked face PNGs are served from; a die's face N loads from
		// `${faceSrcBase}/${id}-${N}.png`.
		faceSrcBase?: string;
	} = $props();

	// The face plane spans u,v in [-1, 1], so a span of 1 covers the whole face — the
	// baked PNG is full-bleed (body colour, edge and icon/value baked in) and is laid
	// edge to edge over each face.
	const FACE_SPAN = 1;
	const CAM_Z = 5;
	const FOCAL = 3.6;

	let container: HTMLDivElement;
	let app: Application | null = null;
	let g: Graphics | null = null;
	let MatrixCtor: new (a: number, b: number, c: number, d: number, tx: number, ty: number) => Matrix;
	let SpriteCtor: typeof import('pixi.js').Sprite;
	let AssetsRef: typeof import('pixi.js').Assets;
	let ready = false;

	// A single tumbling die in the strip. Carries its own six face sprites so dice
	// with different art coexist in one canvas, plus the axis/speed it spins on.
	interface Cell {
		cubeQ: Quat;
		axis: Vec3;
		speed: number;
		cx: number;
		cy: number;
		scale: number;
		color: number;
		faces: Sprite[];
		faceHalf: Array<[number, number]>;
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

	// Load (and cache) the six baked face PNGs for a die, in face order — face N is
	// served from `${faceSrcBase}/${id}-${N}.png`.
	async function loadTextures(spec: DieSpec): Promise<Texture[]> {
		return Promise.all(
			Array.from({ length: 6 }, (_, i) =>
				AssetsRef.load<Texture>(`${faceSrcBase}/${spec.id}-${i + 1}.png`)
			)
		);
	}

	function makeCell(spec: DieSpec, textures: Texture[], cx: number, cy: number, scale: number): Cell {
		const color = spec.color ?? defaultColor;
		const faces: Sprite[] = [];
		const faceHalf: Array<[number, number]> = [];
		for (let n = 1; n <= 6; n++) {
			const sprite = new SpriteCtor(textures[n - 1]);
			sprite.anchor.set(0.5);
			sprite.visible = false;
			faces.push(sprite);
			faceHalf.push([sprite.width / 2, sprite.height / 2]);
			app?.stage.addChild(sprite);
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
			faces,
			faceHalf
		};
	}

	function clearCells() {
		for (const cell of cells) {
			for (const node of cell.faces) {
				node.parent?.removeChild(node);
				node.destroy();
			}
		}
		cells = [];
	}

	// Lay a face's baked PNG edge to edge over its projected quad. The PNG is
	// full-bleed square art, so an affine map from three face-plane points (centre,
	// +right, +up) fits it to the face; `light` (0..1) tints it so faces angled away
	// darken exactly like the backing polygon.
	function positionFace(
		cell: Cell,
		face: (typeof CUBE_FACES)[number],
		worldQ: Quat,
		light: number
	) {
		const sprite = cell.faces[face.value - 1];
		if (!sprite || !MatrixCtor) return;
		const [hw, hh] = cell.faceHalf[face.value - 1];
		const spanV = FACE_SPAN;
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
		sprite.visible = true;
		sprite.tint = shade(0xffffff, light);
		sprite.setFromMatrix(new MatrixCtor(a, b, c, d, cx, cy));
	}

	function draw() {
		if (!g) return;
		g.clear();
		for (const cell of cells) for (const node of cell.faces) node.visible = false;

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
				// Backing polygon fills any sub-pixel gap at the face edge (the affine
				// PNG fit ignores perspective foreshortening) and matches the die body.
				g.poly(poly)
					.fill(shade(cell.color, light))
					.stroke({ width: 2, color: edge, join: 'round', alignment: 0.5 });
				positionFace(cell, face, worldQ, light);
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
		specs.map((s) => `${s.id}|${s.color ?? ''}`).join(';') + '@' + tileSize
	);
	let lastSignature = '';
	$effect(() => {
		const sig = sigKey; // tracked: re-runs when the dice or tile size change
		if (!ready || sig === lastSignature) return;
		lastSignature = sig;
		rebuild();
	});

	onMount(async () => {
		const { Application, Graphics, Sprite, Assets, Matrix } = await import('pixi.js');
		MatrixCtor = Matrix;
		SpriteCtor = Sprite;
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
