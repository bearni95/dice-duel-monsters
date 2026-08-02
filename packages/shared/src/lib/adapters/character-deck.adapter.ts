import { AdapterClass } from './classes/adapter.class';
import type { Character } from '$types/character.type';
import type { Deck } from '$types/deck.type';

/** A character together with the saved deck the admin has given them. */
export interface CharacterWithDeck {
	character: Character;
	deck: Deck;
}

/**
 * Resolves the character→deck assignments authored in the admin package (the
 * `slug -> deckId` map in `static/decks/assignments.json`) against the saved
 * decks manifest, so the app can list the characters that are actually ready to
 * be played against rather than every portrait in the sprite set.
 *
 * Both inputs are static JSON that the admin rewrites, and neither references
 * the other, so an assignment can outlive the deck it points at — those are
 * dropped rather than rendered as a character with no deck.
 */
export class CharacterDeckAdapter extends AdapterClass {
	constructor() {
		super('character-deck');
	}

	/**
	 * Every character that has a deck assigned, paired with that deck, in the
	 * order the character list defines. Assignments naming an unknown character or
	 * a deck that no longer exists are left out.
	 */
	assigned(
		characters: Character[],
		decks: Deck[],
		assignments: Record<string, string>
	): CharacterWithDeck[] {
		const byId = new Map(decks.map((deck) => [deck.id, deck]));

		return characters.flatMap((character) => {
			const deckId = assignments[character.slug];
			if (!deckId) return [];
			const deck = byId.get(deckId);
			return deck ? [{ character, deck }] : [];
		});
	}
}

export const characterDeckAdapter = new CharacterDeckAdapter();
