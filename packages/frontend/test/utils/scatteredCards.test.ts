import { describe, expect, it } from 'vitest';
import {
	buildScatterLayout,
	stepScatteredCards,
	type ScatteredCard
} from '$utils/cards/scatteredCards';

const VIEWPORT = { viewportWidth: 1000, viewportHeight: 800 };
const CARD = { cardWidth: 140, cardAspect: 1415 / 1080 };

// A fixed "random" keeps the layout deterministic: 0.5 means no shuffle drift,
// no jitter, and no tilt, so assertions can be about the grid itself.
const centred = () => 0.5;

function layout(cardIds: number[], overrides = {}) {
	return buildScatterLayout({ cardIds, ...VIEWPORT, ...CARD, random: centred, ...overrides });
}

// Small deterministic PRNG (mulberry32) for the cases that need real spread.
function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state |= 0;
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function card(overrides: Partial<ScatteredCard> = {}): ScatteredCard {
	return {
		cardId: 1,
		homeX: 100,
		homeY: 100,
		x: 100,
		y: 100,
		vx: 0,
		vy: 0,
		rotation: 0,
		...overrides
	};
}

describe('buildScatterLayout', () => {
	it('lays out one card per owned copy', () => {
		const cards = layout([1, 1, 2, 3]);

		expect(cards.map((c) => c.cardId)).toEqual([1, 1, 2, 3]);
	});

	it('starts every card at rest on its home slot', () => {
		for (const c of layout([1, 2, 3])) {
			expect(c.x).toBe(c.homeX);
			expect(c.y).toBe(c.homeY);
			expect(c.vx).toBe(0);
			expect(c.vy).toBe(0);
		}
	});

	it('keeps every card fully inside the viewport', () => {
		const cardHeight = CARD.cardWidth * CARD.cardAspect;
		const cards = buildScatterLayout({
			cardIds: Array.from({ length: 60 }, (_, i) => i),
			...VIEWPORT,
			...CARD
		});

		for (const c of cards) {
			expect(c.homeX).toBeGreaterThanOrEqual(0);
			expect(c.homeY).toBeGreaterThanOrEqual(0);
			expect(c.homeX).toBeLessThanOrEqual(VIEWPORT.viewportWidth - CARD.cardWidth);
			expect(c.homeY).toBeLessThanOrEqual(VIEWPORT.viewportHeight - cardHeight);
		}
	});

	it('tilts cards within the given rotation range', () => {
		const cards = buildScatterLayout({
			cardIds: Array.from({ length: 40 }, (_, i) => i),
			...VIEWPORT,
			...CARD,
			maxRotationDeg: 20
		});

		for (const c of cards) {
			expect(Math.abs(c.rotation)).toBeLessThanOrEqual(20);
		}
	});

	it('drops the oldest copies when the collection is over the cap', () => {
		const cards = layout([1, 2, 3, 4, 5], { maxCards: 3 });

		expect(cards.map((c) => c.cardId)).toEqual([3, 4, 5]);
	});

	it('scatters a small collection over the whole viewport', () => {
		// A seeded generator so the shuffle runs (unlike the fixed 0.5 above, which
		// leaves the grid in order) while the result stays deterministic.
		const cards = buildScatterLayout({
			cardIds: [1, 2, 3, 4, 5, 6],
			...VIEWPORT,
			...CARD,
			random: seeded(1)
		});

		// Six cards out of a filled grid land on six different rows' worth of
		// slots rather than filling the top-left corner.
		expect(new Set(cards.map((c) => c.homeY)).size).toBeGreaterThan(1);
		expect(new Set(cards.map((c) => c.homeX)).size).toBeGreaterThan(1);
	});

	it('returns nothing without cards or a viewport to fill', () => {
		expect(layout([])).toEqual([]);
		expect(layout([1, 2], { viewportWidth: 0 })).toEqual([]);
		expect(layout([1, 2], { viewportHeight: 0 })).toEqual([]);
	});
});

describe('stepScatteredCards', () => {
	const far = { pointerX: -9999, pointerY: -9999 };

	it('leaves a resting card on its home slot when the pointer is away', () => {
		const cards = [card()];

		stepScatteredCards(cards, { ...far, ...VIEWPORT, ...CARD });

		expect(cards[0].x).toBe(100);
		expect(cards[0].y).toBe(100);
	});

	it('pushes a card away from the pointer', () => {
		const cards = [card()];
		// Just left of the card's centre, so it should be shoved to the right.
		const pointerX = 100 + CARD.cardWidth / 2 - 40;
		const pointerY = 100 + (CARD.cardWidth * CARD.cardAspect) / 2;

		stepScatteredCards(cards, { pointerX, pointerY, ...VIEWPORT, ...CARD });

		expect(cards[0].x).toBeGreaterThan(100);
		expect(cards[0].vx).toBeGreaterThan(0);
	});

	it('ignores a pointer outside the repel radius', () => {
		const cards = [card()];

		stepScatteredCards(cards, {
			pointerX: 100 + CARD.cardWidth / 2 + 300,
			pointerY: 100,
			...VIEWPORT,
			...CARD,
			repelRadius: 220
		});

		expect(cards[0].x).toBe(100);
	});

	it('springs a displaced card back towards home', () => {
		const cards = [card({ x: 400, y: 100 })];

		for (let frame = 0; frame < 200; frame++) {
			stepScatteredCards(cards, { ...far, ...VIEWPORT, ...CARD });
		}

		expect(cards[0].x).toBeCloseTo(100, 0);
		expect(cards[0].y).toBeCloseTo(100, 0);
	});

	it('keeps a shoved card inside the viewport', () => {
		const cardHeight = CARD.cardWidth * CARD.cardAspect;
		const cards = [card({ x: 0, y: 0, homeX: 0, homeY: 0 })];

		for (let frame = 0; frame < 60; frame++) {
			// Parked on the card, at full strength, frame after frame.
			stepScatteredCards(cards, {
				pointerX: cards[0].x + CARD.cardWidth / 2,
				pointerY: cards[0].y + cardHeight / 2 + 1,
				...VIEWPORT,
				...CARD,
				repelStrength: 20
			});
		}

		expect(cards[0].x).toBeGreaterThanOrEqual(0);
		expect(cards[0].y).toBeGreaterThanOrEqual(0);
		expect(cards[0].x).toBeLessThanOrEqual(VIEWPORT.viewportWidth - CARD.cardWidth);
		expect(cards[0].y).toBeLessThanOrEqual(VIEWPORT.viewportHeight - cardHeight);
	});

	it('steps every card in the layout', () => {
		const cards = [card({ x: 400 }), card({ cardId: 2, x: 500, homeX: 200 })];

		stepScatteredCards(cards, { ...far, ...VIEWPORT, ...CARD });

		expect(cards[0].x).toBeLessThan(400);
		expect(cards[1].x).toBeLessThan(500);
	});
});
