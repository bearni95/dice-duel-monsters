/**
 * Layout for the scattered-cards backdrop: the player's collection tiled across
 * the viewport at random angles.
 *
 * Kept as pure functions so the maths can be tested without a canvas — the
 * component that owns the backdrop only builds the layout and draws the result.
 *
 * The backdrop is built once and then *amended*: `buildScatterGrid` lays out the
 * slots, `placeCard` fills one of them, `diffCardIds` says which cards joined or
 * left the collection, and `throwOrigin` says where a joining card flies in from.
 * Re-tiling from scratch is reserved for a resize, since a grant that reshuffled
 * every card would read as the whole background reloading.
 */

/** One card in the backdrop: which art to draw, and where. */
export interface ScatteredCard {
	cardId: number;
	/** Top-left position, in CSS pixels. */
	x: number;
	y: number;
	/** Fixed tilt, in degrees. */
	rotation: number;
}

export interface ScatterGridOptions {
	viewportWidth: number;
	viewportHeight: number;
	cardWidth: number;
	/** Card height as a multiple of its width. */
	cardAspect: number;
	/** Injectable randomness, so tests can lay out deterministically. */
	random?: () => number;
}

/** The places a card can sit, plus the bounds a card is kept inside. */
export interface ScatterGrid {
	/** Slot top-left positions, already shuffled. */
	slots: { x: number; y: number }[];
	/** How far either way a card may wander from its slot. */
	jitter: number;
	/** The largest top-left position that still leaves the card fully in view. */
	maxX: number;
	maxY: number;
}

export interface ScatterLayoutOptions extends ScatterGridOptions {
	/** One entry per copy owned, oldest first. */
	cardIds: number[];
	/** Cap on how many cards are laid out at once. */
	maxCards?: number;
	/** Cards are tilted by up to this much either way. */
	maxRotationDeg?: number;
}

/** The tuning the backdrop looks right at, shared with the component's props. */
export const SCATTER_DEFAULTS = {
	/** Height follows from the art's aspect, and the grid steps off this too. */
	cardWidth: 210,
	// Slots scale with the square of the card width, so this cap is the 200 that
	// filled a 1080p screen at 140px divided by 1.5² — about one card per slot,
	// which is enough to cover the viewport without stacking copies pointlessly.
	maxCards: 90,
	maxRotationDeg: 35
} as const;

/**
 * Build the slots the backdrop draws into.
 *
 * They are a grid stepped slightly tighter than the card size, so rotated cards
 * still overlap and the backdrop has no visible gaps, then shuffled — that way a
 * handful of cards scatters across the whole viewport instead of filling the top
 * rows and leaving the rest bare.
 */
export function buildScatterGrid({
	viewportWidth,
	viewportHeight,
	cardWidth,
	cardAspect,
	random = Math.random
}: ScatterGridOptions): ScatterGrid | null {
	if (cardWidth <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return null;

	const cardHeight = cardWidth * cardAspect;
	const stepX = cardWidth * 0.78;
	const stepY = cardHeight * 0.78;
	const cols = Math.max(1, Math.ceil(viewportWidth / stepX) + 1);
	const rows = Math.max(1, Math.ceil(viewportHeight / stepY) + 1);

	// Centre the grid so whatever overflows does so evenly on all sides.
	const gridWidth = (cols - 1) * stepX + cardWidth;
	const gridHeight = (rows - 1) * stepY + cardHeight;
	const offsetX = (viewportWidth - gridWidth) / 2;
	const offsetY = (viewportHeight - gridHeight) / 2;

	const slots: { x: number; y: number }[] = [];
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			slots.push({ x: offsetX + col * stepX, y: offsetY + row * stepY });
		}
	}

	// Fisher-Yates.
	for (let i = slots.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[slots[i], slots[j]] = [slots[j], slots[i]];
	}

	return {
		slots,
		jitter: Math.min(stepX, stepY) * 0.18,
		maxX: Math.max(0, viewportWidth - cardWidth),
		maxY: Math.max(0, viewportHeight - cardHeight)
	};
}

/**
 * Settle one card into a slot, jittered off its exact centre and tilted, so a
 * grid of slots doesn't read as a grid of cards.
 */
export function placeCard(
	grid: ScatterGrid,
	slotIndex: number,
	cardId: number,
	maxRotationDeg: number = SCATTER_DEFAULTS.maxRotationDeg,
	random: () => number = Math.random
): ScatteredCard {
	const slot =
		grid.slots[((slotIndex % grid.slots.length) + grid.slots.length) % grid.slots.length];
	return {
		cardId,
		x: clamp(slot.x + (random() - 0.5) * 2 * grid.jitter, 0, grid.maxX),
		y: clamp(slot.y + (random() - 0.5) * 2 * grid.jitter, 0, grid.maxY),
		rotation: (random() - 0.5) * 2 * maxRotationDeg
	};
}

/**
 * Lay the owned cards out over the viewport, from nothing.
 *
 * Cards past `maxCards` are dropped from the *front*: `cardIds` arrives oldest
 * first, so the cap keeps the newest copies, and their later position in the
 * result paints them on top of older ones.
 */
export function buildScatterLayout({
	cardIds,
	maxCards = SCATTER_DEFAULTS.maxCards,
	maxRotationDeg = SCATTER_DEFAULTS.maxRotationDeg,
	random = Math.random,
	...gridOptions
}: ScatterLayoutOptions): ScatteredCard[] {
	if (!cardIds.length) return [];

	const grid = buildScatterGrid({ ...gridOptions, random });
	if (!grid) return [];

	return capCards(cardIds, maxCards).map((cardId, i) =>
		placeCard(grid, i, cardId, maxRotationDeg, random)
	);
}

/** The copies that fit under the cap, keeping the newest. */
export function capCards(
	cardIds: number[],
	maxCards: number = SCATTER_DEFAULTS.maxCards
): number[] {
	return cardIds.length > maxCards ? cardIds.slice(-maxCards) : cardIds;
}

/**
 * What changed between the cards on screen and the cards that should be, as a
 * multiset difference: `added` is one entry per copy to bring in, `removed` one
 * per copy to take away.
 *
 * Order is deliberately not part of this. A new copy of a card the player
 * already owns arrives *next to its siblings* rather than at the end of the
 * collection, so comparing the two lists position by position would report a
 * whole tail of changes where only one card actually joined.
 */
export function diffCardIds(
	current: number[],
	next: number[]
): { added: number[]; removed: number[] } {
	const balance = new Map<number, number>();
	for (const id of next) balance.set(id, (balance.get(id) ?? 0) + 1);
	for (const id of current) balance.set(id, (balance.get(id) ?? 0) - 1);

	const added: number[] = [];
	const removed: number[] = [];
	for (const [id, delta] of balance) {
		for (let i = 0; i < delta; i++) added.push(id);
		for (let i = 0; i < -delta; i++) removed.push(id);
	}
	return { added, removed };
}

/** The edges a card can be thrown in from. */
export const CARDINAL_EDGES = ['top', 'right', 'bottom', 'left'] as const;
export type CardinalEdge = (typeof CARDINAL_EDGES)[number];

export interface ThrowOriginOptions {
	/** Where the card is headed — its resting top-left position. */
	target: { x: number; y: number };
	viewportWidth: number;
	viewportHeight: number;
	cardWidth: number;
	cardHeight: number;
	random?: () => number;
}

export interface ThrowOrigin {
	/** Off-screen top-left position the card starts from. */
	x: number;
	y: number;
	edge: CardinalEdge;
	/** Degrees of spin still to unwind on arrival, added to the resting tilt. */
	spinDeg: number;
}

/**
 * Where a card joining the backdrop is thrown in from: just past one of the four
 * cardinal edges, roughly across from where it lands, spinning.
 *
 * The clearance is the card's diagonal rather than its width or height, so it
 * starts fully out of view whatever angle it is spinning through.
 */
export function throwOrigin({
	target,
	viewportWidth,
	viewportHeight,
	cardWidth,
	cardHeight,
	random = Math.random
}: ThrowOriginOptions): ThrowOrigin {
	const clearance = Math.hypot(cardWidth, cardHeight);
	const edge = CARDINAL_EDGES[Math.min(CARDINAL_EDGES.length - 1, Math.floor(random() * 4))];

	// A card that flew straight down its own column would look rehearsed, so the
	// entry point slides along the edge it comes from.
	const driftX = (random() - 0.5) * viewportWidth * 0.35;
	const driftY = (random() - 0.5) * viewportHeight * 0.35;

	// One and a bit to two and a half turns, either way round.
	const turns = 1.25 + random() * 1.25;
	const spinDeg = (random() < 0.5 ? -1 : 1) * turns * 360;

	switch (edge) {
		case 'top':
			return { x: target.x + driftX, y: -clearance, edge, spinDeg };
		case 'bottom':
			return { x: target.x + driftX, y: viewportHeight + clearance, edge, spinDeg };
		case 'left':
			return { x: -clearance, y: target.y + driftY, edge, spinDeg };
		case 'right':
		default:
			return { x: viewportWidth + clearance, y: target.y + driftY, edge, spinDeg };
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
