<script lang="ts">
	import classNames from 'classnames';
	import { onMount, untrack } from 'svelte';
	import {
		buildScatterGrid,
		capCards,
		diffCardIds,
		placeCard,
		SCATTER_DEFAULTS,
		throwOrigin,
		type ScatteredCard,
		type ScatterGrid
	} from '$utils/cards/scatteredCards';

	// A full-bleed canvas that tiles the player's collection across the viewport at
	// random angles. The cards are the same pre-generated PNGs GeneratedCardImage
	// renders (static/cards/generated/<id>.png), drawn straight onto a canvas
	// rather than as elements: a filled backdrop is a couple of hundred cards,
	// which is one draw here instead of that many DOM nodes.
	//
	// The backdrop is cumulative. Cards already down are never moved, so a pack
	// landing in the collection doesn't re-tile (and visibly reload) the whole
	// background — the new copies are thrown in, spinning, from one of the four
	// edges and settle into the gaps. Only a resize re-tiles from scratch.
	//
	// Purely decorative — it sits behind the page and takes no pointer events, so
	// whatever is rendered on top stays interactive.
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

	// How long a thrown card takes to land, and how far apart a batch of them is
	// dealt, so a pack arrives card by card rather than all at once.
	const THROW_MS = 900;
	const THROW_STAGGER_MS = 130;
	// The card reads as coming towards the viewer by landing out of a slight
	// enlargement rather than by any change in its art.
	const THROW_OVERSIZE = 0.18;
	// How long a copy that fell off the cap takes to dissolve.
	const FADE_MS = 600;

	let canvas: HTMLCanvasElement | null = $state(null);

	/** A card still on its way in. `null` on every card that has settled. */
	interface Flight {
		fromX: number;
		fromY: number;
		spinDeg: number;
		startAt: number;
	}

	interface PlacedCard extends ScatteredCard {
		/** Which grid slot it holds, so a later card can take one that is free. */
		slotIndex: number;
		flight: Flight | null;
		/**
		 * Set once the copy has left the collection — it dissolves over the next
		 * `FADE_MS` and is then dropped, rather than blinking out of the backdrop.
		 */
		fadeStartAt: number | null;
	}

	// The cards on screen and the slots they sit in — plain state rather than
	// `$state`, since nothing renders from them but `draw`. Paint order is array
	// order, so the newest copies land on top.
	let placed: PlacedCard[] = [];
	let grid: ScatterGrid | null = null;
	let width = 0;
	let height = 0;
	let frameId: number | null = null;
	// The tuning the cards currently down were tiled against, so only a real change
	// to it re-tiles them.
	let tiledFor: string | null = null;

	// Art is loaded once per card id and reused by every copy on screen. Ids whose
	// PNG is missing resolve to `null` and are simply not drawn, which is the
	// backdrop's version of GeneratedCardImage's "card not found" placeholder.
	const images = new Map<number, HTMLImageElement | null>();

	function image(cardId: number): void {
		if (images.has(cardId)) return;

		const img = new Image();
		images.set(cardId, img);
		// A settled backdrop doesn't repaint on its own, so each PNG asks for a
		// redraw as it arrives.
		img.onload = () => draw();
		img.onerror = () => images.set(cardId, null);
		img.src = `/cards/generated/${cardId}.png`;
	}

	/**
	 * Size the backing store to the canvas's box. Returns whether that box has
	 * actually changed: touching `canvas.width` clears the canvas, so a resize
	 * notification that isn't one must not go near it.
	 */
	function measure(): boolean {
		if (!canvas) return false;
		const dpr = window.devicePixelRatio || 1;
		const nextWidth = canvas.clientWidth;
		const nextHeight = canvas.clientHeight;
		const backingWidth = Math.floor(nextWidth * dpr);
		const backingHeight = Math.floor(nextHeight * dpr);

		if (nextWidth === width && nextHeight === height && canvas.width === backingWidth) return false;

		width = nextWidth;
		height = nextHeight;
		canvas.width = backingWidth;
		canvas.height = backingHeight;
		canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
		return true;
	}

	// Sizing, tiling and painting always happen together: the grid is built to fill
	// the canvas, so measuring first is what keeps a resize (or the first paint,
	// before the canvas has been laid out) from tiling against stale dimensions.
	// Every card is re-placed, so this is only ever right when there is nothing on
	// screen worth preserving — a first paint, or a viewport that just changed
	// shape under the cards.
	function rebuild(): void {
		if (!canvas) return;
		measure();
		grid = buildScatterGrid({
			viewportWidth: width,
			viewportHeight: height,
			cardWidth,
			cardAspect: CARD_ASPECT
		});

		placed = grid
			? capCards(cardIds, maxCards).map((cardId, i) => ({
					...placeCard(grid!, i, cardId, maxRotationDeg),
					slotIndex: i % grid!.slots.length,
					flight: null,
					fadeStartAt: null
				}))
			: [];

		for (const card of placed) image(card.cardId);
		draw();
	}

	/**
	 * Bring the backdrop in line with the collection without disturbing it: copies
	 * that left are lifted off, and copies that joined are thrown in from off
	 * screen, one after the next.
	 */
	function sync(ids: number[]): void {
		if (!canvas) return;
		if (!grid) {
			rebuild();
			return;
		}

		// Copies already dissolving are no longer part of the backdrop's collection,
		// so they are not something the diff can ask to remove again.
		const onScreen = placed.filter((card) => card.fadeStartAt === null);
		const { added, removed } = diffCardIds(
			onScreen.map((card) => card.cardId),
			capCards(ids, maxCards)
		);
		if (!added.length && !removed.length) return;

		const now = performance.now();

		// Oldest copy first, which is the one the cap drops and the one furthest
		// down the pile.
		for (const cardId of removed) {
			const card = onScreen.find((c) => c.cardId === cardId && c.fadeStartAt === null);
			if (card) card.fadeStartAt = now;
		}

		const cardHeight = cardWidth * CARD_ASPECT;
		added.forEach((cardId, i) => {
			image(cardId);
			const slotIndex = freeSlotIndex();
			const card = placeCard(grid!, slotIndex, cardId, maxRotationDeg);
			const origin = throwOrigin({
				target: card,
				viewportWidth: width,
				viewportHeight: height,
				cardWidth,
				cardHeight
			});
			placed.push({
				...card,
				slotIndex,
				flight: {
					fromX: origin.x,
					fromY: origin.y,
					spinDeg: origin.spinDeg,
					startAt: now + i * THROW_STAGGER_MS
				},
				fadeStartAt: null
			});
		});

		start();
	}

	// A slot nothing is sitting in, so an arriving card fills a gap rather than
	// stacking on a card already down. A slot whose card is on its way out counts
	// as free — the arriving card lands over it as it dissolves. Once every slot is
	// taken (a collection past the point where it covers the viewport) it doubles
	// up at random.
	function freeSlotIndex(): number {
		if (!grid) return 0;
		const taken = new Set(
			placed.filter((card) => card.fadeStartAt === null).map((card) => card.slotIndex)
		);
		const free: number[] = [];
		for (let i = 0; i < grid.slots.length; i++) if (!taken.has(i)) free.push(i);
		if (!free.length) return Math.floor(Math.random() * grid.slots.length);
		return free[Math.floor(Math.random() * free.length)];
	}

	/** Where a card is right now: at rest, or somewhere along its throw. */
	function frameOf(card: PlacedCard, now: number) {
		if (!card.flight) return { x: card.x, y: card.y, rotation: card.rotation, scale: 1 };

		const t = clamp01((now - card.flight.startAt) / THROW_MS);
		const eased = easeOutCubic(t);
		return {
			x: card.flight.fromX + (card.x - card.flight.fromX) * eased,
			y: card.flight.fromY + (card.y - card.flight.fromY) * eased,
			// The spin unwinds into the tilt the card keeps, so it stops exactly where
			// it would have been laid.
			rotation: card.rotation + card.flight.spinDeg * (1 - eased),
			scale: 1 + THROW_OVERSIZE * (1 - eased)
		};
	}

	/** Full, unless the copy is dissolving off the backdrop. */
	function alphaOf(card: PlacedCard, now: number): number {
		if (card.fadeStartAt === null) return 1;
		return 1 - clamp01((now - card.fadeStartAt) / FADE_MS);
	}

	function draw(): void {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, width, height);

		const now = performance.now();
		const cardHeight = cardWidth * CARD_ASPECT;
		const halfWidth = cardWidth / 2;
		const halfHeight = cardHeight / 2;
		const cornerRadius = cardWidth * CORNER_RADIUS_RATIO;

		// Drawn in order, so the newest copies (last in the layout) land on top.
		for (const card of placed) {
			const img = images.get(card.cardId);
			if (!img?.complete || !img.naturalWidth) continue;

			const alpha = alphaOf(card, now);
			if (alpha <= 0) continue;
			const frame = frameOf(card, now);

			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(frame.x + halfWidth, frame.y + halfHeight);
			ctx.rotate((frame.rotation * Math.PI) / 180);
			if (frame.scale !== 1) ctx.scale(frame.scale, frame.scale);

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

	// The loop only runs while something is in the air or on its way out; a settled
	// backdrop is a static canvas that nothing repaints.
	function tick(): void {
		const now = performance.now();
		let moving = false;

		for (const card of placed) {
			if (!card.flight) continue;
			if (now >= card.flight.startAt + THROW_MS) card.flight = null;
			else moving = true;
		}

		const faded = placed.filter(
			(card) => card.fadeStartAt !== null && now >= card.fadeStartAt + FADE_MS
		);
		if (faded.length) placed = placed.filter((card) => !faded.includes(card));
		moving ||= placed.some((card) => card.fadeStartAt !== null);

		draw();
		frameId = moving ? requestAnimationFrame(tick) : null;
	}

	function start(): void {
		if (frameId === null) frameId = requestAnimationFrame(tick);
	}

	// A thrown card arrives fast and settles, rather than easing off the throw.
	function easeOutCubic(t: number): number {
		return 1 - Math.pow(1 - t, 3);
	}

	function clamp01(t: number): number {
		return Math.max(0, Math.min(1, t));
	}

	onMount(() => {
		// Re-tile on resize: the grid is sized to the viewport, so a stale layout
		// would leave gaps down one side or push cards out of view.
		const observer = new ResizeObserver(() => {
			if (measure()) rebuild();
		});
		if (canvas) observer.observe(canvas);

		return () => {
			observer.disconnect();
			if (frameId !== null) cancelAnimationFrame(frameId);
			frameId = null;
		};
	});

	// A canvas or a tuning change moves every card there is, so there is nothing to
	// preserve: tile from scratch. Reading the tuning into `key` is what subscribes
	// this effect to it — and comparing it against the last tiling is what keeps a
	// collection change (the other effect's business) from re-tiling through here.
	$effect(() => {
		const key = `${cardWidth}:${maxCards}:${maxRotationDeg}`;
		if (!canvas || key === tiledFor) return;
		tiledFor = key;
		untrack(() => rebuild());
	});

	// A collection change (a grant, a sign-in) only ever adds or drops copies, so
	// it amends the backdrop in place and throws the new cards in.
	$effect(() => {
		const ids = cardIds;
		if (canvas) untrack(() => sync(ids));
	});
</script>

<canvas
	bind:this={canvas}
	class={classNames('pointer-events-none fixed inset-0 h-full w-full', classes)}
	aria-hidden="true"
></canvas>
