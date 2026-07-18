import type { ParsedDeck } from '$utils/deck/parseYdk';

// A named, saved deck. Extends the parsed main/extra/side card-id sections with
// an id and a human-readable name so it can be listed and re-selected.
export interface Deck extends ParsedDeck {
	id: string;
	name: string;
	// Card ids the deck owner has toggled off in the deck editor. Disabled cards
	// still count as part of the deck (they show dimmed in the editor) but are
	// filtered out of the playable views — the home-page deck preview and the
	// board's summonable pool. Cards default to enabled, so an absent/empty list
	// means every card is playable.
	disabled?: number[];
	// Card ids the owner has forced on in the deck editor despite the app deeming
	// them not playable (a gimmick monster or an effectless spell/trap). Forcing a
	// card overrides that verdict for this deck, so it shows in the playable views
	// like any enabled card. The inverse of `disabled`; the two never overlap since
	// a card is either playable (uses `disabled`) or not (uses `forced`).
	forced?: number[];
}

// Which saved deck is currently assigned to each side of the board.
export interface DeckSelection {
	id: string;
	playerDeckId: string | null;
	cpuDeckId: string | null;
}
