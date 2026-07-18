import type { ID } from '$types/core.type';
import type { EffectParamValues } from '$types/effect.type';

// One effect template a card implements, with the values the card supplies for
// the template's templated params. `effectId` references a CardEffect template's
// id, as defined on /admin/effects.
export interface CardEffectImplementation {
	// Unique id for this implementation row (a card may implement the same
	// template more than once, e.g. raise Attack and raise HP).
	id: ID;
	effectId: ID;
	// Templated param key → the value this card supplies for it.
	values: EffectParamValues;
}

// Every effect template a single card implements, keyed by the card's id (from
// cardinfo.json). Stored separately from the card catalog, which is read-only.
export interface CardEffects {
	id: ID;
	implementations: CardEffectImplementation[];
}
