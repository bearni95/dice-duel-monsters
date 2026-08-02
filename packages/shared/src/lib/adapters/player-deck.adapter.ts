import { AdapterClass } from './classes/adapter.class';
import {
	DECK_SIZE,
	MAX_COPIES_PER_DECK,
	type PlayerDeck,
	type PlayerDeckCard,
	type PlayerDeckCardRow,
	type PlayerDeckEntry,
	type PlayerDeckRow
} from '$types/player-deck.type';

/**
 * Transforms Supabase deck rows into the shapes the app works with, and holds
 * the pure deck-building rules (copy caps, deck size, validation) so the builder
 * component stays UI-only and the service stays a thin data-access layer.
 *
 * The same rules are enforced in the database (see the player_decks migration);
 * these exist so the UI can disable controls and explain itself before a save is
 * ever attempted, not as the only line of defence.
 */
export class PlayerDeckAdapter extends AdapterClass {
	constructor() {
		super('player-deck');
	}

	// Deck rows plus their (separately fetched) card rows into whole decks. Decks
	// keep the order they were fetched in; a deck with no card rows comes back
	// with an empty list rather than being dropped.
	fromRows(deckRows: PlayerDeckRow[], cardRows: PlayerDeckCardRow[]): PlayerDeck[] {
		const byDeck = new Map<string, PlayerDeckCard[]>();
		for (const row of cardRows) {
			const bucket = byDeck.get(row.deck_id) ?? [];
			bucket.push({ cardId: row.card_id, quantity: row.quantity });
			byDeck.set(row.deck_id, bucket);
		}

		return deckRows.map((row) => ({
			id: row.id,
			name: row.name ?? '',
			cards: byDeck.get(row.id) ?? [],
			enabled: row.enabled ?? false
		}));
	}

	/**
	 * Whether a deck counts as enabled for play. A player with one deck has
	 * already made their choice by owning it, so their only deck plays whether or
	 * not its flag was ever set — the flag only starts to mean anything once
	 * there is a second deck to prefer it over.
	 */
	isEnabled(deck: PlayerDeck, decks: PlayerDeck[]): boolean {
		return decks.length === 1 ? true : deck.enabled;
	}

	/**
	 * The deck the board deals from, or `null` when the player has none. Only one
	 * deck is meant to carry the flag — `playerDeckService.setEnabled` stands the
	 * old one down as it raises the new — but nothing in the database enforces
	 * that, so this still resolves a tie the same way every time: the first enabled
	 * deck in the order they were created.
	 */
	activeDeck(decks: PlayerDeck[]): PlayerDeck | null {
		if (decks.length === 1) return decks[0];
		return decks.find((deck) => deck.enabled) ?? null;
	}

	// A deck's contents as the `save_player_deck` RPC payload.
	toEntries(cards: PlayerDeckCard[]): PlayerDeckEntry[] {
		return cards.map((card) => ({
			card_id: card.cardId,
			quantity: card.quantity
		}));
	}

	// Tally a flat list of owned card ids (one entry per copy, as `playerService`
	// exposes it) into a copies-per-card lookup.
	ownedCounts(ownedIds: number[]): Map<number, number> {
		const counts = new Map<number, number>();
		for (const id of ownedIds) counts.set(id, (counts.get(id) ?? 0) + 1);
		return counts;
	}

	/** Total cards in a deck, counting copies. */
	totalCards(cards: PlayerDeckCard[]): number {
		return cards.reduce((sum, card) => sum + card.quantity, 0);
	}

	/** How many copies of one card a deck currently runs. */
	copiesOf(cards: PlayerDeckCard[], cardId: number): number {
		return cards.find((card) => card.cardId === cardId)?.quantity ?? 0;
	}

	/**
	 * How many copies of a card the player owns that this deck isn't already
	 * running. Decks reference the collection rather than consume it, so this says
	 * nothing about what other decks may run — it is only what is left of this
	 * card to put into this one.
	 */
	copiesOutsideDeck(cards: PlayerDeckCard[], cardId: number, ownedCount: number): number {
		return Math.max(0, ownedCount - this.copiesOf(cards, cardId));
	}

	/**
	 * The most copies of a card a deck may run: the 3-copy cap, further limited by
	 * how many copies the player actually owns. Owning two copies of a card means
	 * a deck can run two of it — but every deck may run those same two, since
	 * decks reference the collection rather than consume it.
	 */
	maxCopies(ownedCount: number): number {
		return Math.min(MAX_COPIES_PER_DECK, ownedCount);
	}

	/** Whether another copy of `cardId` can be added to the deck as it stands. */
	canAdd(cards: PlayerDeckCard[], cardId: number, ownedCount: number): boolean {
		if (this.totalCards(cards) >= DECK_SIZE) return false;
		return this.copiesOf(cards, cardId) < this.maxCopies(ownedCount);
	}

	/**
	 * A copy of `cardId` added to the deck, as a new list. Returns the list
	 * unchanged when the deck is full or the card is already at its cap, so
	 * callers can treat this as a no-op rather than guarding every call.
	 */
	addCopy(cards: PlayerDeckCard[], cardId: number, ownedCount: number): PlayerDeckCard[] {
		if (!this.canAdd(cards, cardId, ownedCount)) return cards;

		const existing = cards.find((card) => card.cardId === cardId);
		if (!existing) return [...cards, { cardId, quantity: 1 }];

		return cards.map((card) =>
			card.cardId === cardId ? { ...card, quantity: card.quantity + 1 } : card
		);
	}

	/**
	 * A copy of `cardId` removed from the deck, as a new list. The entry is
	 * dropped entirely once its last copy goes, so a deck never carries zero-count
	 * entries.
	 */
	removeCopy(cards: PlayerDeckCard[], cardId: number): PlayerDeckCard[] {
		return cards
			.map((card) => (card.cardId === cardId ? { ...card, quantity: card.quantity - 1 } : card))
			.filter((card) => card.quantity > 0);
	}

	/** Every copy of `cardId` removed from the deck, as a new list. */
	removeCard(cards: PlayerDeckCard[], cardId: number): PlayerDeckCard[] {
		return cards.filter((card) => card.cardId !== cardId);
	}

	/**
	 * Why a deck can't be saved yet, as a message for the UI — or `null` when it
	 * is valid. Mirrors the checks `save_player_deck` performs server-side.
	 */
	validate(name: string, cards: PlayerDeckCard[], owned: Map<number, number>): string | null {
		if (!name.trim()) return 'Give your deck a name.';

		const total = this.totalCards(cards);
		if (total !== DECK_SIZE) {
			const missing = DECK_SIZE - total;
			return missing > 0
				? `Add ${missing} more ${missing === 1 ? 'card' : 'cards'} to reach ${DECK_SIZE}.`
				: `Remove ${-missing} ${-missing === 1 ? 'card' : 'cards'} to get down to ${DECK_SIZE}.`;
		}

		for (const card of cards) {
			if (card.quantity > MAX_COPIES_PER_DECK) {
				return `A deck may hold at most ${MAX_COPIES_PER_DECK} copies of the same card.`;
			}
			if (card.quantity > (owned.get(card.cardId) ?? 0)) {
				return 'A deck cannot hold more copies of a card than you own.';
			}
		}

		return null;
	}
}

export const playerDeckAdapter = new PlayerDeckAdapter();
