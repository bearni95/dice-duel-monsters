import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '$types/deck.type';

// The pool and the collection grid both fetch two generated files: the card
// catalog and the grantable allow-list. Both are stubbed here so a test can put a
// card in the catalog and *not* in the allow-list — the exact shape of the bug
// these filters exist to prevent, where a card the player owns has no committed
// PNG and renders as a "card not found" placeholder.
const decks: Deck[] = [];
vi.mock('$services/deck.service', () => ({
	ensureDecks: async () => decks
}));

import { CardApiAdapter, invalidateCatalog } from '$adapters/cardApi.adapter';

type StubCard = {
	id: number;
	name: string;
	type: string;
	billboard?: string;
	playable: boolean;
};

function monster(id: number, overrides: Partial<StubCard> = {}): StubCard {
	return {
		id,
		name: `Card ${id}`,
		type: 'Normal Monster',
		billboard: `/cards/monster-billboards/${id}.png`,
		playable: true,
		...overrides
	};
}

// Serve the two generated files the adapter reads, and nothing else — an
// unexpected URL fails loudly rather than resolving to an empty result.
function stubFetch(cards: StubCard[], grantableIds: number[]) {
	global.fetch = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.startsWith('/cards/catalog.json')) {
			return new Response(JSON.stringify({ cards }), { status: 200 });
		}
		if (url.startsWith('/cards/grantable.json')) {
			return new Response(JSON.stringify({ cardIds: grantableIds }), { status: 200 });
		}
		throw new Error(`unexpected fetch: ${url}`);
	}) as typeof fetch;
}

describe('CardApiAdapter', () => {
	beforeEach(() => {
		// Both files are memoised for the lifetime of the tab, so each test starts
		// from a clean slate.
		invalidateCatalog();
		decks.length = 0;
	});

	describe('ownedUnique', () => {
		it('tallies copies and preserves first-appearance order', async () => {
			stubFetch([monster(1), monster(2)], [1, 2]);

			const owned = await new CardApiAdapter().ownedUnique([2, 1, 2]);

			expect(owned.map((o) => [o.card.id, o.count])).toEqual([
				[2, 2],
				[1, 1]
			]);
		});

		it('drops owned cards that are not on the grantable allow-list', async () => {
			// Card 2 is a perfectly good catalog entry — it simply has no baked PNG, so
			// it never made the allow-list. A collection granted under an older rule
			// can still contain it.
			stubFetch([monster(1), monster(2)], [1]);

			const owned = await new CardApiAdapter().ownedUnique([1, 2, 2]);

			expect(owned.map((o) => o.card.id)).toEqual([1]);
		});

		it('drops owned cards missing from the catalog entirely', async () => {
			stubFetch([monster(1)], [1, 99]);

			const owned = await new CardApiAdapter().ownedUnique([1, 99]);

			expect(owned.map((o) => o.card.id)).toEqual([1]);
		});
	});

	describe('loadAvailableCards', () => {
		function deck(ids: number[], disabled: number[] = []): Deck {
			return { id: 'd', name: 'D', main: ids, extra: [], side: [], disabled } as unknown as Deck;
		}

		it('returns the deck cards that are playable, billboarded and allow-listed', async () => {
			decks.push(deck([1, 2]));
			stubFetch([monster(1), monster(2)], [1, 2]);

			const available = await new CardApiAdapter().loadAvailableCards();

			expect(available.map((c) => c.id).sort()).toEqual([1, 2]);
		});

		it('excludes a card with no baked art even when the catalog would allow it', async () => {
			// Card 2 passes every catalog filter — playable monster, has a billboard,
			// sits in a saved deck — and is still not drawable, because its PNG was
			// never baked. Only the allow-list knows that.
			decks.push(deck([1, 2]));
			stubFetch([monster(1), monster(2)], [1]);

			const available = await new CardApiAdapter().loadAvailableCards();

			expect(available.map((c) => c.id)).toEqual([1]);
		});

		it('excludes non-playable, billboard-less, spell and disabled cards', async () => {
			decks.push(deck([1, 2, 3, 4, 5], [5]));
			stubFetch(
				[
					monster(1),
					monster(2, { playable: false }),
					monster(3, { billboard: undefined }),
					{ id: 4, name: 'Spell', type: 'Spell Card', playable: true },
					monster(5)
				],
				// Everything is allow-listed, so only the catalog rules can exclude a
				// card here — the allow-list must not be the *only* thing filtering.
				[1, 2, 3, 4, 5]
			);

			const available = await new CardApiAdapter().loadAvailableCards();

			expect(available.map((c) => c.id)).toEqual([1]);
		});
	});

	describe('randomCardIds', () => {
		it('only ever draws from the pool it is given', () => {
			const pool = [monster(7), monster(8)] as never[];
			const drawn = new CardApiAdapter().randomCardIds(pool, 50);

			expect(drawn).toHaveLength(50);
			expect(new Set(drawn).size).toBeLessThanOrEqual(2);
			for (const id of drawn) expect([7, 8]).toContain(id);
		});
	});
});
