/**
 * Layout and motion for the scattered-cards backdrop: the player's collection
 * tiled across the viewport at random angles, springing back into place after
 * the cursor pushes it aside.
 *
 * Kept as pure functions so the maths can be tested without a canvas — the
 * component that owns the backdrop only builds the layout, steps it once per
 * frame, and draws the result.
 */

/** One card in the backdrop: where it belongs, where it is, and how fast. */
export interface ScatteredCard {
	cardId: number;
	/** The slot the card springs back to. */
	homeX: number;
	homeY: number;
	/** Current top-left position, in CSS pixels. */
	x: number;
	y: number;
	/** Current velocity, in CSS pixels per frame. */
	vx: number;
	vy: number;
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

export interface ScatterStepOptions {
	/** Pointer position in CSS pixels; cards within `repelRadius` are pushed away. */
	pointerX: number;
	pointerY: number;
	viewportWidth: number;
	viewportHeight: number;
	cardWidth: number;
	cardAspect: number;
	repelRadius?: number;
	repelStrength?: number;
	/** How hard a card is pulled back to its home slot. */
	springK?: number;
	/** Velocity retained each frame; below 1 so the motion settles. */
	damping?: number;
}

/** The tuning the backdrop looks right at, shared with the component's props. */
export const SCATTER_DEFAULTS = {
	cardWidth: 140,
	maxCards: 200,
	maxRotationDeg: 35,
	repelRadius: 220,
	repelStrength: 1.4,
	springK: 0.03,
	damping: 0.84
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
		const x = clamp(slot.x + (random() - 0.5) * 2 * jitter, 0, maxX);
		const y = clamp(slot.y + (random() - 0.5) * 2 * jitter, 0, maxY);
		return {
			cardId,
			homeX: x,
			homeY: y,
			x,
			y,
			vx: 0,
			vy: 0,
			rotation: (random() - 0.5) * 2 * maxRotationDeg
		};
	});
}

/**
 * Advance the layout one frame: each card is pulled towards its home slot and
 * pushed away from the pointer, then moved by the resulting velocity and kept
 * inside the viewport.
 *
 * Mutates `cards` in place. This runs on every animation frame over a couple of
 * hundred cards, so it deliberately avoids allocating a new array per frame; the
 * caller owns the array and hands the same one back each time.
 *
 * Put the pointer far outside the viewport (or pass `Infinity`) when it has left
 * the page, and the cards simply spring home.
 */
export function stepScatteredCards(
	cards: ScatteredCard[],
	{
		pointerX,
		pointerY,
		viewportWidth,
		viewportHeight,
		cardWidth,
		cardAspect,
		repelRadius = SCATTER_DEFAULTS.repelRadius,
		repelStrength = SCATTER_DEFAULTS.repelStrength,
		springK = SCATTER_DEFAULTS.springK,
		damping = SCATTER_DEFAULTS.damping
	}: ScatterStepOptions
): void {
	const halfWidth = cardWidth / 2;
	const halfHeight = (cardWidth * cardAspect) / 2;
	const maxX = Math.max(0, viewportWidth - cardWidth);
	const maxY = Math.max(0, viewportHeight - cardWidth * cardAspect);
	const radiusSq = repelRadius * repelRadius;

	for (const card of cards) {
		const dx = card.x + halfWidth - pointerX;
		const dy = card.y + halfHeight - pointerY;
		const distSq = dx * dx + dy * dy;

		let ax = (card.homeX - card.x) * springK;
		let ay = (card.homeY - card.y) * springK;

		// Repulsion falls off quadratically to nothing at the edge of the radius,
		// so cards drift out of the cursor's way rather than snapping.
		if (distSq < radiusSq && distSq > 0.0001) {
			const dist = Math.sqrt(distSq);
			const falloff = 1 - dist / repelRadius;
			const force = falloff * falloff * repelStrength * repelRadius * 0.05;
			ax += (dx / dist) * force;
			ay += (dy / dist) * force;
		}

		card.vx = (card.vx + ax) * damping;
		card.vy = (card.vy + ay) * damping;
		card.x = clamp(card.x + card.vx, 0, maxX);
		card.y = clamp(card.y + card.vy, 0, maxY);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
