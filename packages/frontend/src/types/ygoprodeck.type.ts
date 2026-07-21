/**
 * YGOProDeck Community Deck Search API types
 *
 * Types for the external, community-submitted deck search endpoint:
 * https://ygoprodeck.com/api/decks/getDecks.php
 *
 * The browser cannot hit that endpoint directly (CORS), so requests are
 * proxied through our own SvelteKit server route at /decks/search.
 */

/** Raw deck object as returned by the YGOProDeck API. */
export interface YgoProDeckApiDeck {
	deck_name: string;
	username: string;
	main_deck: string; // stringified JSON array of card-id strings
	extra_deck: string;
	side_deck: string;
	format: string;
	submit_date: string;
	deck_views: number;
	deck_price: string;
	pretty_url: string;
}

/** Parameters accepted by the deck search proxy. */
export interface YgoProDeckSearchParams {
	name?: string;
	format?: string;
	limit?: number;
	offset?: number;
}
