import type { ID } from '$types/core.type';

// The on-board creature attributes an effect can target. These map to the
// numeric stats that exist on IGameCreature once a creature is on the board.
export type CreatureStat = 'atk' | 'hp' | 'def' | 'cost' | 'speed' | 'reach';

// Human-readable labels for each on-board stat, used to populate selects.
export const CREATURE_STATS: Array<{ value: CreatureStat; label: string }> = [
	{ value: 'atk', label: 'Attack' },
	{ value: 'hp', label: 'HP' },
	{ value: 'def', label: 'Defense' },
	{ value: 'cost', label: 'Cost' },
	{ value: 'speed', label: 'Speed' },
	{ value: 'reach', label: 'Reach' }
];

// The kinds of effect the editor knows how to build. Kept as a union so more
// kinds can be added later without loosening the type.
// - `gain-stat`: raises an on-board attribute for a card.
// - `requirement`: a gate describing which cards are candidates for the rest of
//   the effects; it holds card criteria rather than templated params.
// - `destroy` / `flip` / `follow`: marker effects with no configuration — they
//   simply exist and are referenced by name.
export type EffectKind = 'gain-stat' | 'requirement' | 'destroy' | 'flip' | 'follow';

export const EFFECT_KINDS: Array<{ value: EffectKind; label: string }> = [
	{ value: 'gain-stat', label: 'Gain stat' },
	{ value: 'requirement', label: 'Requirement' },
	{ value: 'destroy', label: 'Destroy' },
	{ value: 'flip', label: 'Flip' },
	{ value: 'follow', label: 'Follow' }
];

// Effect kinds that carry no configuration — they just exist.
export type SimpleEffectKind = 'destroy' | 'flip' | 'follow';

// The top-level card categories, mirroring the /admin/cards filters. A card's
// category is derived from its Yu-Gi-Oh! card type (Monster/Spell/Trap).
export type CardCategory = 'monster' | 'spell' | 'trap';

export const CARD_CATEGORIES: Array<{ value: CardCategory; label: string }> = [
	{ value: 'monster', label: 'Monster' },
	{ value: 'spell', label: 'Spell' },
	{ value: 'trap', label: 'Trap' }
];

// The monster races (a.k.a. monster "types": Warrior, Spellcaster, …) a
// requirement can constrain on. Mirrors the monster `race` values in the card
// catalog, used to populate the requirement editor's Type select.
export const MONSTER_RACES: string[] = [
	'Aqua',
	'Beast',
	'Beast-Warrior',
	'Creator God',
	'Cyberse',
	'Dinosaur',
	'Divine-Beast',
	'Dragon',
	'Fairy',
	'Fiend',
	'Fish',
	'Illusion',
	'Insect',
	'Machine',
	'Plant',
	'Psychic',
	'Pyro',
	'Reptile',
	'Rock',
	'Sea Serpent',
	'Spellcaster',
	'Thunder',
	'Warrior',
	'Winged Beast',
	'Wyrm',
	'Zombie'
];

// Criteria a card must satisfy to be a candidate for the rest of the effects.
// Every field is optional — an empty string means "any". `category` and
// `subType` mirror the /admin/cards filters (sub-type is a monster variety, or a
// spell/trap race), `attribute` is the monster attribute (DARK, LIGHT, …), and
// `race` is the monster race / "type" (Warrior, Spellcaster, …) from MONSTER_RACES.
export interface RequirementCriteria {
	category: CardCategory | '';
	subType: string;
	attribute: string;
	race: string;
}

// The type of value a parameter holds. `stat` is picked from the on-board
// attributes; `number` and `text` are free-form.
export type EffectParamType = 'stat' | 'number' | 'text';

// How a parameter's value is produced:
// - `fixed`: always the same `defaultValue`.
// - `templated`: each card fills it in when implementing the effect.
// - `dice`: roll `dice` six-sided dice and add their total (number params only).
export type EffectParamMode = 'fixed' | 'templated' | 'dice';

export const EFFECT_PARAM_MODES: Array<{ value: EffectParamMode; label: string }> = [
	{ value: 'fixed', label: 'Fixed' },
	{ value: 'templated', label: 'Templated' },
	{ value: 'dice', label: 'd6 roll' }
];

// A single parameter of an effect. `defaultValue` is the value used when the
// mode is `fixed`, and doubles as the fallback / preview value for `templated`
// params before a card has customized them. `dice` is the number of d6 summed
// when the mode is `dice`.
export interface EffectParam {
	// Placeholder token used in the effect's description, e.g. `stat` → {stat}.
	key: string;
	label: string;
	type: EffectParamType;
	mode: EffectParamMode;
	defaultValue: string | number;
	// Number of six-sided dice rolled and summed when `mode` is `dice`.
	dice?: number;
}

// Fields shared by every effect kind.
interface BaseCardEffect {
	id: ID;
	name: string;
}

// A "gain stat" effect. Cards reference it and supply values for its templated
// params to customize what it does.
export interface GainStatEffect extends BaseCardEffect {
	kind: 'gain-stat';
	// Template string with `{key}` tokens filled from the params, e.g.
	// "Raise {stat} by {amount}".
	description: string;
	params: EffectParam[];
}

// A "requirement" effect. Rather than doing something on the board, it defines
// which cards are eligible to have the other effects applied to them.
export interface RequirementEffect extends BaseCardEffect {
	kind: 'requirement';
	requirement: RequirementCriteria;
}

// A marker effect with no configuration (e.g. "destroy", "flip", "follow"). It carries a
// static description used purely for display.
export interface SimpleEffect extends BaseCardEffect {
	kind: SimpleEffectKind;
	description: string;
}

// An on-board card effect definition.
export type CardEffect = GainStatEffect | RequirementEffect | SimpleEffect;

// Values a card supplies for an effect template's templated params, keyed by
// param key.
export type EffectParamValues = Record<string, string | number>;
