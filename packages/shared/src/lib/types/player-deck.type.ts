/**
 * Player-built decks: named 30-card selections drawn from the cards a player
 * owns. Persisted in the `player_decks` / `player_deck_cards` tables (see the
 * supabase package migrations), which enforce the same rules the UI does.
 *
 * Copies are never consumed by a deck — owning one copy of a card lets it sit in
 * every deck at once — so decks reference the collection rather than draw from
 * it.
 */

/** Exactly how many cards (counting copies) a deck must hold to be saveable. */
export const DECK_SIZE = 30;

/** The hard cap on copies of one card within a single deck. */
export const MAX_COPIES_PER_DECK = 3;

/** One card in a deck, with how many copies of it the deck runs. */
export interface PlayerDeckCard {
	/** The numeric card id (the Yu-Gi-Oh! passcode). */
	cardId: number;
	/** Copies in this deck, always between 1 and `MAX_COPIES_PER_DECK`. */
	quantity: number;
}

/** A saved deck belonging to the signed-in player. */
export interface PlayerDeck {
	/** Database id (uuid). */
	id: string;
	/** Player-chosen deck name. */
	name: string;
	/** The deck's contents, one entry per distinct card. */
	cards: PlayerDeckCard[];
}

/**
 * The reactive deck state exposed by `playerDeckService`. Loaded from Supabase
 * on sign-in and cleared on sign-out, mirroring `playerService`.
 */
export interface PlayerDeckState {
	/** Every deck the player has saved. */
	decks: PlayerDeck[];
	/** `true` while the decks are being loaded from Supabase. */
	loading: boolean;
	/** `true` while a deck save or delete is in flight. */
	saving: boolean;
	/**
	 * The message from the last failed write, or `null`. Edits persist on their
	 * own now, so a failure has no save button to report against — it surfaces
	 * here, and the store is resynced with what the server actually holds.
	 */
	error: string | null;
}

/** A row of the `player_decks` table, as returned by the Supabase client. */
export interface PlayerDeckRow {
	id: string;
	name: string;
}

/** A row of the `player_deck_cards` table, as returned by the Supabase client. */
export interface PlayerDeckCardRow {
	deck_id: string;
	card_id: number;
	quantity: number;
}

/** One entry of the `save_player_deck` RPC payload. */
export interface PlayerDeckEntry {
	card_id: number;
	quantity: number;
}
