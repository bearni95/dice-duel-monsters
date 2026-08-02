/**
 * Layout for the scattered-cards backdrop: the player's collection tiled across
 * the viewport at random angles.
 *
 * Kept as a pure function so the maths can be tested without a canvas — the
 * component that owns the backdrop only builds the layout and draws the result.
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

export interface ScatterLayoutOptions {
	/** One entry per copy owned, oldest first. */
	cardIds: number[];
	viewportWidth: number;
	viewportHeight: number;
	cardWidth: number;
	/** Card height as a multiple of its width. */
	cardAspect: number;
	/** Cap on how many cards are laid out at once. */
	maxCards?: number;
	/** Cards are tilted by up to this much either way. */
	maxRotationDeg?: number;
	/** Injectable randomness, so tests can lay out deterministically. */
	random?: () => number;
}

/** The tuning the backdrop looks right at, shared with the component's props. */
export const SCATTER_DEFAULTS = {
	/** Height follows from the art's aspect, and the grid steps off this too. */
	cardWidth: 210,
	maxCards: 200,
	maxRotationDeg: 35
} as const;

/**
 * Lay the owned cards out over the viewport.
 *
 * Slots are a grid stepped slightly tighter than the card size, so rotated cards
 * still overlap and the backdrop has no visible gaps, then shuffled — that way a
 * handful of cards scatters across the whole viewport instead of filling the top
 * rows and leaving the rest bare. Cards past `maxCards` are dropped from the
 * *front*: `cardIds` arrives oldest first, so the cap keeps the newest copies,
 * and their later position in the result paints them on top of older ones.
 */
export function buildScatterLayout({
	cardIds,
	viewportWidth,
	viewportHeight,
	cardWidth,
	cardAspect,
	maxCards = SCATTER_DEFAULTS.maxCards,
	maxRotationDeg = SCATTER_DEFAULTS.maxRotationDeg,
	random = Math.random
}: ScatterLayoutOptions): ScatteredCard[] {
	if (!cardIds.length || cardWidth <= 0 || viewportWidth <= 0 || viewportHeight <= 0) return [];

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

	const kept = cardIds.length > maxCards ? cardIds.slice(-maxCards) : cardIds;

	const jitter = Math.min(stepX, stepY) * 0.18;
	const maxX = Math.max(0, viewportWidth - cardWidth);
	const maxY = Math.max(0, viewportHeight - cardHeight);

	return kept.map((cardId, i) => {
		const slot = slots[i % slots.length];
		return {
			cardId,
			x: clamp(slot.x + (random() - 0.5) * 2 * jitter, 0, maxX),
			y: clamp(slot.y + (random() - 0.5) * 2 * jitter, 0, maxY),
			rotation: (random() - 0.5) * 2 * maxRotationDeg
		};
	});
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
