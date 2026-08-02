<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import {
		buildScatterLayout,
		stepScatteredCards,
		SCATTER_DEFAULTS,
		type ScatteredCard
	} from '$utils/cards/scatteredCards';

	// A full-bleed canvas that tiles the player's collection across the viewport at
	// random angles and pushes the cards aside as the cursor moves through them.
	// The cards are the same pre-generated PNGs GeneratedCardImage renders
	// (static/cards/generated/<id>.png), drawn straight onto a canvas rather than
	// as elements: a filled backdrop is a couple of hundred cards moving every
	// frame, which is one draw loop here instead of that many DOM nodes.
	//
	// Purely decorative — it sits behind the page and takes no pointer events, so
	// whatever is rendered on top stays interactive.
	let {
		cardIds,
		classes = '',
		cardWidth = SCATTER_DEFAULTS.cardWidth,
		maxCards = SCATTER_DEFAULTS.maxCards,
		maxRotationDeg = SCATTER_DEFAULTS.maxRotationDeg,
		repelRadius = SCATTER_DEFAULTS.repelRadius,
		repelStrength = SCATTER_DEFAULTS.repelStrength,
		springK = SCATTER_DEFAULTS.springK,
		damping = SCATTER_DEFAULTS.damping
	}: {
		/** The collection to draw, one entry per copy owned, oldest first. */
		cardIds: number[];
		classes?: string;
		cardWidth?: number;
		maxCards?: number;
		maxRotationDeg?: number;
		repelRadius?: number;
		repelStrength?: number;
		springK?: number;
		damping?: number;
	} = $props();

	// The generated card art is 1080x1415.
	const CARD_ASPECT = 1415 / 1080;
	const CORNER_RADIUS = 8;

	let canvas: HTMLCanvasElement | null = $state(null);

	// The laid-out cards, mutated in place by the physics step every frame — plain
	// state rather than `$state`, since nothing renders from it but the draw loop.
	let cards: ScatteredCard[] = [];
	let width = 0;
	let height = 0;

	// Off-viewport until the pointer actually enters, so the cards start at rest.
	let pointerX = -Infinity;
	let pointerY = -Infinity;

	// Art is loaded once per card id and reused by every copy on screen. Ids whose
	// PNG is missing resolve to `null` and are simply not drawn, which is the
	// backdrop's version of GeneratedCardImage's "card not found" placeholder.
	const images = new Map<number, HTMLImageElement | null>();

	function image(cardId: number): HTMLImageElement | null {
		const cached = images.get(cardId);
		if (cached !== undefined) return cached;

		const img = new Image();
		images.set(cardId, img);
		img.onerror = () => images.set(cardId, null);
		img.src = `/cards/generated/${cardId}.png`;
		return img;
	}

	function measure(): void {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		width = canvas.clientWidth;
		height = canvas.clientHeight;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
	}

	// Sizing and tiling always happen together: the grid is built to fill the
	// canvas, so measuring first is what keeps a resize (or the very first frame,
	// before the canvas has been laid out) from tiling against stale dimensions.
	function layout(): void {
		measure();
		cards = buildScatterLayout({
			cardIds,
			viewportWidth: width,
			viewportHeight: height,
			cardWidth,
			cardAspect: CARD_ASPECT,
			maxCards,
			maxRotationDeg
		});
		for (const card of cards) image(card.cardId);
	}

	function draw(): void {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		const cardHeight = cardWidth * CARD_ASPECT;
		const halfWidth = cardWidth / 2;
		const halfHeight = cardHeight / 2;

		// Drawn in order, so the newest copies (last in the layout) land on top.
		for (const card of cards) {
			const img = images.get(card.cardId);
			if (!img?.complete || !img.naturalWidth) continue;

			ctx.save();
			ctx.translate(card.x + halfWidth, card.y + halfHeight);
			ctx.rotate((card.rotation * Math.PI) / 180);

			ctx.beginPath();
			if (ctx.roundRect) {
				ctx.roundRect(-halfWidth, -halfHeight, cardWidth, cardHeight, CORNER_RADIUS);
			} else {
				ctx.rect(-halfWidth, -halfHeight, cardWidth, cardHeight);
			}

			// Filling the card's silhouette first is what casts the drop shadow; the
			// shadow is then cleared so it isn't re-cast around the art itself.
			ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
			ctx.shadowBlur = 18;
			ctx.shadowOffsetY = 6;
			ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
			ctx.fill();
			ctx.shadowColor = 'transparent';
			ctx.shadowBlur = 0;
			ctx.shadowOffsetY = 0;

			ctx.clip();
			ctx.drawImage(img, -halfWidth, -halfHeight, cardWidth, cardHeight);
			ctx.restore();
		}
	}

	onMount(() => {
		const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

		const onPointerMove = (event: PointerEvent) => {
			pointerX = event.clientX;
			pointerY = event.clientY;
		};
		// Cards spring home whenever the pointer isn't on the page.
		const onPointerLeave = () => {
			pointerX = -Infinity;
			pointerY = -Infinity;
		};

		// Re-tile on resize: the grid is sized to the viewport, so a stale layout
		// would leave gaps down one side or push cards out of view.
		const observer = new ResizeObserver(() => layout());
		if (canvas) observer.observe(canvas);

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerleave', onPointerLeave);
		window.addEventListener('blur', onPointerLeave);

		let frame = requestAnimationFrame(function loop() {
			// With reduced motion the cards are laid out and left alone; the cursor
			// doesn't disturb them.
			if (!reduceMotion?.matches) {
				stepScatteredCards(cards, {
					pointerX,
					pointerY,
					viewportWidth: width,
					viewportHeight: height,
					cardWidth,
					cardAspect: CARD_ASPECT,
					repelRadius,
					repelStrength,
					springK,
					damping
				});
			}
			draw();
			frame = requestAnimationFrame(loop);
		});

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerleave', onPointerLeave);
			window.removeEventListener('blur', onPointerLeave);
		};
	});

	// Re-tile whenever the collection changes (a grant, a sign-in, a sign-out) so
	// new cards join the backdrop without a reload. `layout` reads `cardIds` and
	// the tuning props, which is what subscribes this effect to them.
	$effect(() => {
		if (canvas) layout();
	});
</script>

<canvas
	bind:this={canvas}
	class={classNames('pointer-events-none fixed inset-0 h-full w-full', classes)}
	aria-hidden="true"
></canvas>
