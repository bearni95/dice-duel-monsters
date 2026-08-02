<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import {
		buildScatterLayout,
		SCATTER_DEFAULTS,
		type ScatteredCard
	} from '$utils/cards/scatteredCards';

	// A full-bleed canvas that tiles the player's collection across the viewport at
	// random angles. The cards are the same pre-generated PNGs GeneratedCardImage
	// renders (static/cards/generated/<id>.png), drawn straight onto a canvas
	// rather than as elements: a filled backdrop is a couple of hundred cards,
	// which is one draw here instead of that many DOM nodes.
	//
	// Purely decorative and static — it sits behind the page and takes no pointer
	// events, so whatever is rendered on top stays interactive.
	let {
		cardIds,
		classes = '',
		cardWidth = SCATTER_DEFAULTS.cardWidth,
		maxCards = SCATTER_DEFAULTS.maxCards,
		maxRotationDeg = SCATTER_DEFAULTS.maxRotationDeg
	}: {
		/** The collection to draw, one entry per copy owned, oldest first. */
		cardIds: number[];
		classes?: string;
		cardWidth?: number;
		maxCards?: number;
		maxRotationDeg?: number;
	} = $props();

	// The generated card art is 1080x1415.
	const CARD_ASPECT = 1415 / 1080;
	// Scaled with the card so the corners keep their shape at any width.
	const CORNER_RADIUS_RATIO = 8 / 140;

	let canvas: HTMLCanvasElement | null = $state(null);

	// The laid-out cards — plain state rather than `$state`, since nothing renders
	// from it but `draw`.
	let cards: ScatteredCard[] = [];
	let width = 0;
	let height = 0;

	// Art is loaded once per card id and reused by every copy on screen. Ids whose
	// PNG is missing resolve to `null` and are simply not drawn, which is the
	// backdrop's version of GeneratedCardImage's "card not found" placeholder.
	const images = new Map<number, HTMLImageElement | null>();

	function image(cardId: number): void {
		if (images.has(cardId)) return;

		const img = new Image();
		images.set(cardId, img);
		// Nothing repaints on its own, so each PNG asks for a redraw as it arrives.
		img.onload = () => draw();
		img.onerror = () => images.set(cardId, null);
		img.src = `/cards/generated/${cardId}.png`;
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

	// Sizing, tiling and painting always happen together: the grid is built to fill
	// the canvas, so measuring first is what keeps a resize (or the first paint,
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
		draw();
	}

	function draw(): void {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		const cardHeight = cardWidth * CARD_ASPECT;
		const halfWidth = cardWidth / 2;
		const halfHeight = cardHeight / 2;
		const cornerRadius = cardWidth * CORNER_RADIUS_RATIO;

		// Drawn in order, so the newest copies (last in the layout) land on top.
		for (const card of cards) {
			const img = images.get(card.cardId);
			if (!img?.complete || !img.naturalWidth) continue;

			ctx.save();
			ctx.translate(card.x + halfWidth, card.y + halfHeight);
			ctx.rotate((card.rotation * Math.PI) / 180);

			ctx.beginPath();
			if (ctx.roundRect) {
				ctx.roundRect(-halfWidth, -halfHeight, cardWidth, cardHeight, cornerRadius);
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
		// Re-tile on resize: the grid is sized to the viewport, so a stale layout
		// would leave gaps down one side or push cards out of view.
		const observer = new ResizeObserver(() => layout());
		if (canvas) observer.observe(canvas);

		return () => observer.disconnect();
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
