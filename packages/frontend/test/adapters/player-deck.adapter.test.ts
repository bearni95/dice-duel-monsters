import { describe, expect, it } from 'vitest';
import { playerDeckAdapter } from '$adapters/player-deck.adapter';
import { DECK_SIZE, type PlayerDeck, type PlayerDeckCard } from '$types/player-deck.type';

// A deck of exactly DECK_SIZE cards, spread over 10 distinct ids at 3 copies
// each, where every id is owned in enough copies to be legal.
function fullDeck(): { cards: PlayerDeckCard[]; owned: Map<number, number> } {
	const cards: PlayerDeckCard[] = [];
	const owned = new Map<number, number>();
	for (let i = 1; i <= 10; i++) {
		cards.push({ cardId: i, quantity: 3 });
		owned.set(i, 3);
	}
	return { cards, owned };
}

describe('playerDeckAdapter', () => {
	describe('fromRows', () => {
		it('groups card rows under their deck', () => {
			const decks = playerDeckAdapter.fromRows(
				[
					{ id: 'a', name: 'First', enabled: true },
					{ id: 'b', name: 'Second', enabled: false }
				],
				[
					{ deck_id: 'a', card_id: 1, quantity: 3 },
					{ deck_id: 'b', card_id: 2, quantity: 1 },
					{ deck_id: 'a', card_id: 3, quantity: 2 }
				]
			);

			expect(decks).toHaveLength(2);
			expect(decks[0].cards).toEqual([
				{ cardId: 1, quantity: 3 },
				{ cardId: 3, quantity: 2 }
			]);
			expect(decks[1].cards).toEqual([{ cardId: 2, quantity: 1 }]);
		});

		it('carries each deck’s enabled flag through', () => {
			const decks = playerDeckAdapter.fromRows(
				[
					{ id: 'a', name: 'First', enabled: true },
					{ id: 'b', name: 'Second', enabled: false }
				],
				[]
			);

			expect(decks.map((deck) => deck.enabled)).toEqual([true, false]);
		});

		it('keeps a deck with no card rows', () => {
			const decks = playerDeckAdapter.fromRows([{ id: 'a', name: 'Empty', enabled: false }], []);
			expect(decks).toEqual([{ id: 'a', name: 'Empty', cards: [], enabled: false }]);
		});
	});

	describe('activeDeck', () => {
		// The decks the rules are applied to; only the id and flag matter here.
		const deck = (id: string, enabled: boolean): PlayerDeck => ({
			id,
			name: id,
			cards: [],
			enabled
		});

		it('has no deck to play when the player has none', () => {
			expect(playerDeckAdapter.activeDeck([])).toBeNull();
		});

		it('plays a lone deck even though it was never enabled', () => {
			const only = deck('a', false);
			expect(playerDeckAdapter.activeDeck([only])).toBe(only);
			expect(playerDeckAdapter.isEnabled(only, [only])).toBe(true);
		});

		it('plays the enabled deck once there is more than one', () => {
			const decks = [deck('a', false), deck('b', true)];
			expect(playerDeckAdapter.activeDeck(decks)).toBe(decks[1]);
			expect(playerDeckAdapter.isEnabled(decks[0], decks)).toBe(false);
		});

		it('plays the first enabled deck when several are enabled', () => {
			const decks = [deck('a', false), deck('b', true), deck('c', true)];
			expect(playerDeckAdapter.activeDeck(decks)).toBe(decks[1]);
		});

		it('plays nothing when several decks exist and none is enabled', () => {
			expect(playerDeckAdapter.activeDeck([deck('a', false), deck('b', false)])).toBeNull();
		});
	});

	describe('maxCopies', () => {
		it('caps at 3 however many copies are owned', () => {
			expect(playerDeckAdapter.maxCopies(10)).toBe(3);
			expect(playerDeckAdapter.maxCopies(3)).toBe(3);
		});

		it('caps at the owned count when fewer than 3 are owned', () => {
			expect(playerDeckAdapter.maxCopies(2)).toBe(2);
			expect(playerDeckAdapter.maxCopies(0)).toBe(0);
		});
	});

	describe('addCopy', () => {
		it('adds a first copy of an unseen card', () => {
			expect(playerDeckAdapter.addCopy([], 7, 3)).toEqual([{ cardId: 7, quantity: 1 }]);
		});

		it('increments an existing entry', () => {
			const cards = [{ cardId: 7, quantity: 1 }];
			expect(playerDeckAdapter.addCopy(cards, 7, 3)).toEqual([{ cardId: 7, quantity: 2 }]);
		});

		it('refuses a fourth copy of the same card', () => {
			const cards = [{ cardId: 7, quantity: 3 }];
			expect(playerDeckAdapter.addCopy(cards, 7, 10)).toBe(cards);
		});

		it('refuses more copies than the player owns', () => {
			const cards = [{ cardId: 7, quantity: 2 }];
			expect(playerDeckAdapter.addCopy(cards, 7, 2)).toBe(cards);
		});

		it('refuses to overfill the deck', () => {
			const { cards } = fullDeck();
			expect(playerDeckAdapter.addCopy(cards, 99, 3)).toBe(cards);
		});

		it('does not mutate the list it is given', () => {
			const cards = [{ cardId: 7, quantity: 1 }];
			playerDeckAdapter.addCopy(cards, 7, 3);
			expect(cards).toEqual([{ cardId: 7, quantity: 1 }]);
		});
	});

	describe('removeCopy', () => {
		it('decrements an entry', () => {
			expect(playerDeckAdapter.removeCopy([{ cardId: 7, quantity: 2 }], 7)).toEqual([
				{ cardId: 7, quantity: 1 }
			]);
		});

		it('drops the entry once its last copy goes', () => {
			expect(playerDeckAdapter.removeCopy([{ cardId: 7, quantity: 1 }], 7)).toEqual([]);
		});
	});

	describe('totalCards', () => {
		it('counts copies, not distinct cards', () => {
			expect(
				playerDeckAdapter.totalCards([
					{ cardId: 1, quantity: 3 },
					{ cardId: 2, quantity: 2 }
				])
			).toBe(5);
		});
	});

	describe('validate', () => {
		it('accepts a legal deck', () => {
			const { cards, owned } = fullDeck();
			expect(playerDeckAdapter.validate('Mono Blue', cards, owned)).toBeNull();
		});

		it('requires a name', () => {
			const { cards, owned } = fullDeck();
			expect(playerDeckAdapter.validate('   ', cards, owned)).toBe('Give your deck a name.');
		});

		it('reports how many cards are missing', () => {
			const { cards, owned } = fullDeck();
			const short = playerDeckAdapter.removeCopy(cards, 1);
			expect(playerDeckAdapter.validate('Nearly', short, owned)).toBe(
				`Add 1 more card to reach ${DECK_SIZE}.`
			);
		});

		it('reports an overfull deck', () => {
			const { cards, owned } = fullDeck();
			const over = [...cards, { cardId: 11, quantity: 2 }];
			owned.set(11, 2);
			expect(playerDeckAdapter.validate('Too big', over, owned)).toBe(
				`Remove 2 cards to get down to ${DECK_SIZE}.`
			);
		});

		it('rejects more copies than are owned', () => {
			const { cards, owned } = fullDeck();
			owned.set(1, 1);
			expect(playerDeckAdapter.validate('Borrowed', cards, owned)).toBe(
				'A deck cannot hold more copies of a card than you own.'
			);
		});

		it('rejects a fourth copy of a card', () => {
			// 9 cards at 3 copies plus one at 4 still totals 31, so trim another to
			// isolate the copy-cap failure from the deck-size one.
			const owned = new Map<number, number>();
			const cards: PlayerDeckCard[] = [];
			for (let i = 1; i <= 9; i++) {
				cards.push({ cardId: i, quantity: 3 });
				owned.set(i, 4);
			}
			cards.push({ cardId: 10, quantity: 3 });
			owned.set(10, 4);
			cards[0].quantity = 4;
			cards[1].quantity = 2;

			expect(playerDeckAdapter.validate('Four-of', cards, owned)).toBe(
				'A deck may hold at most 3 copies of the same card.'
			);
		});
	});

	describe('toEntries', () => {
		it('shapes the deck for the save RPC', () => {
			expect(playerDeckAdapter.toEntries([{ cardId: 7, quantity: 2 }])).toEqual([
				{ card_id: 7, quantity: 2 }
			]);
		});
	});

	describe('ownedCounts', () => {
		it('tallies a flat list of owned ids', () => {
			expect([...playerDeckAdapter.ownedCounts([1, 2, 1, 1, 3])]).toEqual([
				[1, 3],
				[2, 1],
				[3, 1]
			]);
		});
	});
});
