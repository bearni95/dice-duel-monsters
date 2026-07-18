import type { Deck } from '$types/deck.type';

/**
 * Drop the deck's disabled card ids from a list, keeping order and duplicates so
 * copy counts survive. Cards default to enabled, so a deck with no `disabled`
 * list returns its ids unchanged. Used by the playable views (home-page preview,
 * board) to hide cards the owner turned off in the deck editor.
 */
export function enabledCardIds(deck: Deck, ids: number[]): number[] {
	if (!deck.disabled?.length) return ids;
	const off = new Set(deck.disabled);
	return ids.filter((id) => !off.has(id));
}

/**
 * The deck's forced card ids — cards the owner turned on despite being flagged
 * not playable. Passed to the card endpoint's `force` param so they survive the
 * playable filter in the home preview and on the board. Any id that's also been
 * disabled is dropped, so the two lists never contradict each other.
 */
export function forcedCardIds(deck: Deck): number[] {
	if (!deck.forced?.length) return [];
	if (!deck.disabled?.length) return deck.forced;
	const off = new Set(deck.disabled);
	return deck.forced.filter((id) => !off.has(id));
}
