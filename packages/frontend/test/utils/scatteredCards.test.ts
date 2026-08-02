import { describe, expect, it } from 'vitest';
import {
	buildScatterLayout,
	CARDINAL_EDGES,
	diffCardIds,
	throwOrigin
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

describe('buildScatterLayout', () => {
	it('lays out one card per owned copy', () => {
		const cards = layout([1, 1, 2, 3]);

		expect(cards.map((c) => c.cardId)).toEqual([1, 1, 2, 3]);
	});

	it('keeps every card fully inside the viewport', () => {
		const cardHeight = CARD.cardWidth * CARD.cardAspect;
		const cards = buildScatterLayout({
			cardIds: Array.from({ length: 60 }, (_, i) => i),
			...VIEWPORT,
			...CARD
		});

		for (const c of cards) {
			expect(c.x).toBeGreaterThanOrEqual(0);
			expect(c.y).toBeGreaterThanOrEqual(0);
			expect(c.x).toBeLessThanOrEqual(VIEWPORT.viewportWidth - CARD.cardWidth);
			expect(c.y).toBeLessThanOrEqual(VIEWPORT.viewportHeight - cardHeight);
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
		expect(new Set(cards.map((c) => c.y)).size).toBeGreaterThan(1);
		expect(new Set(cards.map((c) => c.x)).size).toBeGreaterThan(1);
	});

	it('returns nothing without cards or a viewport to fill', () => {
		expect(layout([])).toEqual([]);
		expect(layout([1, 2], { viewportWidth: 0 })).toEqual([]);
		expect(layout([1, 2], { viewportHeight: 0 })).toEqual([]);
	});
});

describe('diffCardIds', () => {
	it('reports nothing for an unchanged collection', () => {
		expect(diffCardIds([1, 2, 2, 3], [1, 2, 2, 3])).toEqual({ added: [], removed: [] });
	});

	it('reports a new copy of an already-owned card as one addition', () => {
		// The expanded collection groups copies together, so the second 2 arrives in
		// the middle of the list rather than at its end — a positional diff would
		// call that three changes.
		const { added, removed } = diffCardIds([1, 2, 3], [1, 2, 2, 3]);

		expect(added).toEqual([2]);
		expect(removed).toEqual([]);
	});

	it('reports the copies that fell off the cap as removals', () => {
		const { added, removed } = diffCardIds([1, 2, 3], [2, 3, 4, 4]);

		expect(added.sort()).toEqual([4, 4]);
		expect(removed).toEqual([1]);
	});

	it('reports a whole collection arriving and leaving', () => {
		expect(diffCardIds([], [7, 7])).toEqual({ added: [7, 7], removed: [] });
		expect(diffCardIds([7, 7], [])).toEqual({ added: [], removed: [7, 7] });
	});
});

describe('throwOrigin', () => {
	const THROW = {
		target: { x: 400, y: 300 },
		...VIEWPORT,
		cardWidth: CARD.cardWidth,
		cardHeight: CARD.cardWidth * CARD.cardAspect
	};

	it('starts the card fully outside whichever edge it comes from', () => {
		const random = seeded(7);

		for (let i = 0; i < 200; i++) {
			const origin = throwOrigin({ ...THROW, random });
			const outside =
				origin.x + THROW.cardWidth <= 0 ||
				origin.y + THROW.cardHeight <= 0 ||
				origin.x >= VIEWPORT.viewportWidth ||
				origin.y >= VIEWPORT.viewportHeight;

			expect(outside).toBe(true);
		}
	});

	it('throws from all four cardinal edges', () => {
		const random = seeded(3);
		const edges = new Set(
			Array.from({ length: 200 }, () => throwOrigin({ ...THROW, random }).edge)
		);

		expect(edges).toEqual(new Set(CARDINAL_EDGES));
	});

	it('spins the card at least a full turn on the way in', () => {
		const random = seeded(11);

		for (let i = 0; i < 100; i++) {
			expect(Math.abs(throwOrigin({ ...THROW, random }).spinDeg)).toBeGreaterThanOrEqual(360);
		}
	});
});
