import { ObjectServiceClass } from '$services/classes/object-service.class';
import type { ParsedDeck } from '$utils/deck/parseYdk';

// The player's deck, persisted to localStorage so the board can use it as the
// player's hand instead of random cards.
export interface PlayerDeck extends ParsedDeck {
	id: string;
}

export const deckService = new ObjectServiceClass<PlayerDeck>('player-deck', {
	id: 'player-deck',
	main: [],
	extra: [],
	side: []
});
