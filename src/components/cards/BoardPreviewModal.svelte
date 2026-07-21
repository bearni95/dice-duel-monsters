<script lang="ts">
	import { onMount } from 'svelte';
	import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
	import type { IGameCreature } from '$adapters/creature.adapter';
	import {
		ensureCardPositions,
		getCardPosition,
		setCardPosition,
		DEFAULT_CARD_POSITION
	} from '$services/card-positions.service';

	// A creature preview on the game board's isometric grid: the same billboard
	// sprite, shadow ellipse and purple summon frame the board page draws for a
	// summoned unit, dropped onto an endless (pan/zoomable) diamond grid. Opened
	// from the admin card browser so a monster's on-board look can be checked
	// without starting a match. The parent mounts this only while open (so onMount
	// spins the Pixi app up per view and the returned teardown disposes it).
	let { creature, onClose }: { creature: IGameCreature; onClose: () => void } = $props();

	let host: HTMLDivElement;

	// Slider position for the image size, in [-1, 1]: 0 is the card's original board
	// size, negatives shrink it and positives enlarge it. The factor is exponential
	// so the midpoint lands exactly on the original size and the ends are symmetric
	// (2^-2 = 0.25× at the far left, 2^2 = 4× at the far right).
	let sizeValue = $state(0);
	let sizeFactor = $derived(Math.pow(2, sizeValue * 2));

	// Pixel offset of the image (its red square) relative to its cell (the purple
	// square), in the board's world units. 0/0 centers it; the sliders nudge it up
	// to one cell width in each direction (see OFFSET_RANGE below).
	let offsetX = $state(0);
	let offsetY = $state(0);

	// The persisted size factor ↔ slider position mapping is the inverse of the
	// above: value = log2(factor) / 2, clamped to the slider's range.
	function sliderForFactor(factor: number): number {
		if (!Number.isFinite(factor) || factor <= 0) return 0;
		return Math.max(-1, Math.min(1, Math.log2(factor) / 2));
	}

	// Load the card's stored board position and seat the sliders on it, so the modal
	// opens showing the positioning last saved for this card (default = borders
	// matching, centered). Kept separate from the Pixi onMount below.
	let savedPosition = $state({ ...DEFAULT_CARD_POSITION });
	let saving = $state(false);
	let saveError = $state('');
	let saved = $state(false);
	// The controls are "dirty" (Save enabled) once any of them differs from the
	// stored value.
	let dirty = $derived(
		Math.abs(sizeFactor - savedPosition.size) > 1e-4 ||
			Math.abs(offsetX - savedPosition.x) > 1e-4 ||
			Math.abs(offsetY - savedPosition.y) > 1e-4
	);

	onMount(async () => {
		await ensureCardPositions();
		seatControls(getCardPosition(creature.id));
	});

	// Point the size/offset sliders at a stored position.
	function seatControls(position: { size: number; x: number; y: number }) {
		savedPosition = { ...position };
		sizeValue = sliderForFactor(position.size);
		offsetX = position.x;
		offsetY = position.y;
	}

	// Persist the current position for this card. Fields left at their default clear
	// from the card's stored entry (see the endpoint); a real adjustment records it
	// so the next catalog build bakes the corrected positioning in.
	async function savePosition() {
		saving = true;
		saveError = '';
		saved = false;
		try {
			await setCardPosition(creature.id, { size: sizeFactor, x: offsetX, y: offsetY });
			savedPosition = getCardPosition(creature.id);
			saved = true;
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Could not save the positioning.';
		} finally {
			saving = false;
		}
	}

	// Reset every control back to the default (borders matching, centered).
	function resetControls() {
		sizeValue = 0;
		offsetX = 0;
		offsetY = 0;
	}

	// The live creature sprite and its base (original) scale, kept as plain refs so
	// the size slider can rescale it without wrapping the Pixi object in a proxy.
	// `spriteReady` flips once it's built so the $effect below applies the slider.
	let previewSprite: Sprite | null = null;
	let baseScale = 1;
	let spriteReady = $state(false);

	// The image's red border and its rectangle, kept so its stroke can be redrawn at
	// a constant width as the image is resized (see the $effect below).
	let previewBorder: Graphics | null = null;
	let borderRect: { x: number; y: number; w: number; h: number } | null = null;

	// Re-apply the size factor and x/y offset to the sprite whenever they (or the
	// sprite) change. Anchored at the feet (anchor.y = 1), so scaling keeps the
	// creature on its cell center; the offset then nudges the whole image (and its
	// red border, a sprite child) away from that center. The purple cell square is
	// independent (added to the world), so it never moves — the offset is measured
	// against it. The red border is a sprite child, so scaling it would fatten or
	// thin its line — to keep the line a constant on-screen width (1 world unit, like
	// the grid and purple square), its local stroke is redrawn as 1 / (sprite scale),
	// which cancels the sprite's scale exactly.
	$effect(() => {
		const factor = sizeFactor;
		const dx = offsetX;
		const dy = offsetY;
		if (!spriteReady || !previewSprite) return;

		const scale = baseScale * factor;
		previewSprite.scale.set(scale);
		previewSprite.position.set(dx, dy);

		if (previewBorder && borderRect) {
			previewBorder
				.clear()
				.rect(borderRect.x, borderRect.y, borderRect.w, borderRect.h)
				.stroke({ width: 1 / scale, color: 0xef4444, alignment: 0.5 });
		}
	});

	// Same isometric tile metrics and zoom limits the board uses, so the preview
	// renders the creature at the exact scale it appears in a real match.
	const TILE_WIDTH = 64;
	const TILE_HEIGHT = 32;
	const MIN_ZOOM = 0.25;
	const MAX_ZOOM = 4;

	// How far the x/y offset sliders can push the image from its cell center, in
	// world units — one cell width (the purple square's side) in each direction.
	const OFFSET_RANGE = TILE_WIDTH;

	// Shadow ellipse radii — the board's values (half the cell's half-extents at the
	// 2:1 isometric proportion) so the footprint sits inside the diamond.
	const SHADOW_RADIUS_X = (TILE_WIDTH / 2) * 0.5;
	const SHADOW_RADIUS_Y = (TILE_HEIGHT / 2) * 0.5;

	// The isometric screen position of a grid cell's center.
	function isoPosOf(x: number, y: number) {
		return {
			x: (x - y) * (TILE_WIDTH / 2),
			y: (x + y) * (TILE_HEIGHT / 2)
		};
	}

	// Tight bounding box of a texture's opaque pixels, in the texture's own
	// (unscaled) space — billboards carry uneven transparent margins, so the visible
	// creature isn't at the image center. Mirrors the board's opaqueBounds so the
	// sprite is anchored on the creature, not the padded image. Cached per source.
	const opaqueBoundsCache = new WeakMap<
		object,
		{ x: number; y: number; width: number; height: number }
	>();
	function opaqueBounds(texture: Texture) {
		const source = texture.source;
		const cached = opaqueBoundsCache.get(source);
		if (cached) return cached;

		const w = Math.max(1, Math.round(texture.width));
		const h = Math.max(1, Math.round(texture.height));
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		ctx.drawImage(source.resource as CanvasImageSource, 0, 0, w, h);
		const { data } = ctx.getImageData(0, 0, w, h);

		const alphaThreshold = 12;
		let minX = w;
		let minY = h;
		let maxX = -1;
		let maxY = -1;
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}

		const bounds =
			maxX < minX
				? { x: 0, y: 0, width: w, height: h }
				: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
		opaqueBoundsCache.set(source, bounds);
		return bounds;
	}

	onMount(() => {
		const app = new Application();

		let camera: Container;
		let gridGfx: Graphics;

		let dragging = false;
		let lastX = 0;
		let lastY = 0;

		let destroyed = false;

		// Redraw the diamond grid so it fills the whole visible canvas at the current
		// pan/zoom — the "endless" grid. The four screen corners are projected back
		// into grid space to find the range of cells on screen, then every diamond in
		// that (padded) range is stroked. Called on init and after every pan/zoom.
		function drawGrid() {
			if (!gridGfx) return;
			gridGfx.clear();

			const scale = camera.scale.x;

			// Project a screen point into grid (x, y) coordinates.
			const toGrid = (sx: number, sy: number) => {
				const wx = (sx - camera.x) / scale;
				const wy = (sy - camera.y) / scale;
				return {
					gx: (wx / (TILE_WIDTH / 2) + wy / (TILE_HEIGHT / 2)) / 2,
					gy: (wy / (TILE_HEIGHT / 2) - wx / (TILE_WIDTH / 2)) / 2
				};
			};

			const corners = [
				toGrid(0, 0),
				toGrid(app.screen.width, 0),
				toGrid(0, app.screen.height),
				toGrid(app.screen.width, app.screen.height)
			];

			let minGX = Infinity;
			let maxGX = -Infinity;
			let minGY = Infinity;
			let maxGY = -Infinity;
			for (const c of corners) {
				minGX = Math.min(minGX, c.gx);
				maxGX = Math.max(maxGX, c.gx);
				minGY = Math.min(minGY, c.gy);
				maxGY = Math.max(maxGY, c.gy);
			}

			// Pad by one cell so no partial diamond is clipped at the edges.
			const x0 = Math.floor(minGX) - 1;
			const x1 = Math.ceil(maxGX) + 1;
			const y0 = Math.floor(minGY) - 1;
			const y1 = Math.ceil(maxGY) + 1;

			for (let y = y0; y <= y1; y++) {
				for (let x = x0; x <= x1; x++) {
					const { x: isoX, y: isoY } = isoPosOf(x, y);
					gridGfx
						.moveTo(isoX, isoY - TILE_HEIGHT / 2)
						.lineTo(isoX + TILE_WIDTH / 2, isoY)
						.lineTo(isoX, isoY + TILE_HEIGHT / 2)
						.lineTo(isoX - TILE_WIDTH / 2, isoY)
						.closePath();
				}
			}

			gridGfx.stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
		}

		async function init() {
			await app.init({
				resizeTo: host,
				background: '#1b1b1b',
				antialias: true
			});
			if (destroyed) {
				app.destroy(true, { children: true });
				return;
			}

			host.appendChild(app.canvas);

			camera = new Container();
			app.stage.addChild(camera);

			// The endless grid lives at the back of the camera; the shadow and sprite
			// are layered over it, matching the board's shadows-under-units order.
			gridGfx = new Graphics();
			camera.addChild(gridGfx);

			const units = new Container();
			camera.addChild(units);

			// Center cell (0, 0) horizontally and a little below the vertical midline,
			// so the creature (which rises from its cell) sits framed in the canvas.
			camera.scale.set(2);
			camera.x = app.screen.width / 2;
			camera.y = app.screen.height * 0.6;

			drawGrid();

			// Shadow ellipse on the creature's cell (0, 0), under everything else.
			const shadow = new Graphics()
				.ellipse(0, 0, SHADOW_RADIUS_X, SHADOW_RADIUS_Y)
				.fill({ color: 0x000000, alpha: 0.5 });
			units.addChild(shadow);

			// Purple cell square, independent of the image: a square whose side equals a
			// grid cell's horizontal diagonal (TILE_WIDTH), centered on the cell center
			// (x = 0) with its bottom edge flush with it (y = 0). Drawn straight into the
			// world so it never moves or resizes with the image size slider; its 1px
			// stroke matches the grid outlines.
			const cellSquare = new Graphics()
				.rect(-TILE_WIDTH / 2, -TILE_WIDTH, TILE_WIDTH, TILE_WIDTH)
				.stroke({ width: 1, color: 0xa855f7, alignment: 0.5 });
			cellSquare.eventMode = 'none';
			units.addChild(cellSquare);

			if (creature.billboard) {
				const texture = await Assets.load(creature.billboard);
				if (destroyed) return;

				const sprite = new Sprite(texture);

				// As wide as the cell, with the billboard's bottom edge on the tile. This
				// base scale is the "original" size the slider multiplies from.
				baseScale = TILE_WIDTH / texture.width;
				sprite.scale.set(baseScale);

				// Anchor X on the opaque art's center (not the padded image) so the
				// creature is centered on its cell; Y at 1 keeps its feet on the tile so
				// resizing pivots on the cell center.
				const ob = opaqueBounds(texture);
				const anchorX = (ob.x + ob.width / 2) / texture.width;
				sprite.anchor.set(anchorX, 1);

				// The image's own red border, hugging the full image rectangle. It's a
				// child of the sprite, so it tracks the image as the size slider scales it,
				// but its stroke width is redrawn to stay a constant 1 world unit (see the
				// $effect) so the line never fattens or thins with the image size.
				const border = new Graphics();
				border.eventMode = 'none';
				sprite.addChild(border);

				units.addChild(sprite);

				// Publish the sprite + border so the size slider's $effect can rescale the
				// image and redraw the border at a constant width.
				previewSprite = sprite;
				previewBorder = border;
				borderRect = {
					x: -anchorX * texture.width,
					y: -texture.height,
					w: texture.width,
					h: texture.height
				};
				spriteReady = true;
			}

			setupControls();
		}

		function setupControls() {
			const canvas = app.canvas;

			canvas.addEventListener('pointerdown', (e) => {
				if (e.button !== 0) return;
				dragging = true;
				lastX = e.clientX;
				lastY = e.clientY;
				canvas.setPointerCapture(e.pointerId);
			});

			canvas.addEventListener('pointermove', (e) => {
				if (!dragging) return;
				camera.x += e.clientX - lastX;
				camera.y += e.clientY - lastY;
				lastX = e.clientX;
				lastY = e.clientY;
				drawGrid();
			});

			function stopDrag(e: PointerEvent) {
				if (!dragging) return;
				dragging = false;
				if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
			}

			canvas.addEventListener('pointerup', stopDrag);
			canvas.addEventListener('pointercancel', stopDrag);
			canvas.addEventListener('pointerleave', () => (dragging = false));

			canvas.addEventListener(
				'wheel',
				(e) => {
					e.preventDefault();

					const rect = canvas.getBoundingClientRect();
					const mouseX = e.clientX - rect.left;
					const mouseY = e.clientY - rect.top;

					const oldScale = camera.scale.x;
					const worldX = (mouseX - camera.x) / oldScale;
					const worldY = (mouseY - camera.y) / oldScale;

					const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
					const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldScale * zoomFactor));

					camera.scale.set(newScale);
					camera.x = mouseX - worldX * newScale;
					camera.y = mouseY - worldY * newScale;

					drawGrid();
				},
				{ passive: false }
			);

			// Keep the grid filling the canvas after a resize (the modal is responsive).
			app.renderer.on('resize', drawGrid);
		}

		init();

		return () => {
			destroyed = true;
			spriteReady = false;
			previewSprite = null;
			previewBorder = null;
			borderRect = null;
			app.destroy(true, { children: true });
		};
	});
</script>

<div class="modal modal-open z-40">
	<div class="modal-box flex h-[85vh] max-h-[85vh] w-[90vw] max-w-5xl flex-col p-0">
		<div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
			<div class="flex flex-col">
				<span class="text-xs font-semibold tracking-wide uppercase opacity-60">Board preview</span>
				<span class="text-lg font-bold">{creature.name}</span>
			</div>
			<button class="btn btn-sm btn-circle btn-ghost" aria-label="Close" onclick={onClose}>✕</button>
		</div>

		<div class="relative min-h-0 flex-1">
			<div bind:this={host} class="absolute inset-0"></div>
			<div
				class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-base-100/80 px-3 py-1 text-xs text-base-content/70 shadow"
			>
				Drag to pan · scroll to zoom
			</div>
		</div>

		<!-- Positioning controls: size scales the image (its red square), while X/Y
		     nudge it relative to the cell (the purple square). Each slider's midpoint is
		     the default. Saving persists to data/cards/positions.json so the next
		     catalog build bakes the corrected positioning in. -->
		<div class="flex flex-col gap-2 border-t border-base-300 px-4 py-3">
			<div class="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
				<span class="text-xs font-semibold tracking-wide uppercase opacity-60">Size</span>
				<input
					type="range"
					class="range range-secondary range-sm"
					min="-1"
					max="1"
					step="0.01"
					bind:value={sizeValue}
				/>
				<span class="w-16 text-right font-mono text-xs opacity-70">{sizeFactor.toFixed(2)}×</span>

				<span class="text-xs font-semibold tracking-wide uppercase opacity-60">X</span>
				<input
					type="range"
					class="range range-primary range-sm"
					min={-OFFSET_RANGE}
					max={OFFSET_RANGE}
					step="1"
					bind:value={offsetX}
				/>
				<span class="w-16 text-right font-mono text-xs opacity-70">{offsetX.toFixed(0)} px</span>

				<span class="text-xs font-semibold tracking-wide uppercase opacity-60">Y</span>
				<input
					type="range"
					class="range range-primary range-sm"
					min={-OFFSET_RANGE}
					max={OFFSET_RANGE}
					step="1"
					bind:value={offsetY}
				/>
				<span class="w-16 text-right font-mono text-xs opacity-70">{offsetY.toFixed(0)} px</span>
			</div>

			<div class="flex items-center justify-between gap-3">
				{#if saveError}
					<span class="text-error text-xs" role="alert">{saveError}</span>
				{:else if saved && !dirty}
					<span class="text-success text-xs">
						Positioning saved. It will be baked into the catalog on the next build.
					</span>
				{:else}
					<span class="text-xs opacity-50">
						Each slider's midpoint is the default (borders matching, centered).
					</span>
				{/if}

				<div class="flex shrink-0 items-center gap-2">
					<button class="btn btn-ghost btn-xs" onclick={resetControls}>Reset</button>
					<button class="btn btn-primary btn-sm" disabled={saving || !dirty} onclick={savePosition}>
						{#if saving}
							<span class="loading loading-spinner loading-xs"></span>
						{/if}
						Save
					</button>
				</div>
			</div>
		</div>
	</div>
	<button class="modal-backdrop bg-black/60" aria-label="Close preview" onclick={onClose}></button>
</div>
