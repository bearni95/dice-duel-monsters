import { ArrayServiceClass } from '$services/classes/array-service.class';
import type { CardEffect, RequirementEffect } from '$types/effect.type';

// The default on-board effects seeded when no effects have been saved yet.
// "Gain stat" raises an on-board attribute for a card; both the attribute and
// the amount are templated so each card customizes them when implementing it.
// "Requirement" is a gate: it describes which cards are candidates for the rest
// of the effects. Its criteria are left as "any" by default.
const BASE_EFFECTS: CardEffect[] = [
	{
		id: 'gain-stat',
		kind: 'gain-stat',
		name: 'Gain stat',
		description: 'Raise {stat} by {amount}',
		params: [
			{ key: 'stat', label: 'Attribute', type: 'stat', mode: 'templated', defaultValue: 'atk' },
			{ key: 'amount', label: 'Amount', type: 'number', mode: 'templated', defaultValue: 1 }
		]
	},
	{
		id: 'requirement',
		kind: 'requirement',
		name: 'Requirement',
		requirement: { category: '', subType: '', attribute: '', race: '' }
	},
	{
		id: 'destroy',
		kind: 'destroy',
		name: 'Destroy',
		description: 'Destroy the target'
	},
	{
		id: 'flip',
		kind: 'flip',
		name: 'Flip',
		description: 'Flip this card'
	},
	{
		id: 'follow',
		kind: 'follow',
		name: 'Follow',
		description: 'Follows the card it is equiped to'
	}
];

// Requirement gates for the curated equip-spell cards (see
// static/card-effects/assignments.json). Each equip spell that grants an
// attribute- or type-restricted ATK/DEF bonus references one of these so its
// implementation reads "Requires <criteria> monster". Only the attributes and
// monster races (types) that a curated equip spell actually targets are shipped;
// the rest of the catalog has no restricted equip spell to attach.
const EQUIP_REQUIREMENT_ATTRIBUTES = ['DARK', 'FIRE', 'LIGHT', 'WATER', 'WIND'];
const EQUIP_REQUIREMENT_RACES = [
	'Aqua',
	'Beast',
	'Beast-Warrior',
	'Cyberse',
	'Dinosaur',
	'Dragon',
	'Fairy',
	'Fiend',
	'Insect',
	'Machine',
	'Plant',
	'Psychic',
	'Reptile',
	'Spellcaster',
	'Thunder',
	'Warrior',
	'Zombie'
];

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const EQUIP_REQUIREMENT_EFFECTS: RequirementEffect[] = [
	...EQUIP_REQUIREMENT_ATTRIBUTES.map((attribute) => ({
		id: `req-attr-${attribute.toLowerCase()}`,
		kind: 'requirement' as const,
		name: `Requires ${attribute} monster`,
		requirement: { category: 'monster' as const, subType: '', attribute, race: '' }
	})),
	...EQUIP_REQUIREMENT_RACES.map((race) => ({
		id: `req-type-${slugify(race)}`,
		kind: 'requirement' as const,
		name: `Requires ${race} monster`,
		requirement: { category: 'monster' as const, subType: '', attribute: '', race }
	}))
];

const DEFAULT_EFFECTS: CardEffect[] = [...BASE_EFFECTS, ...EQUIP_REQUIREMENT_EFFECTS];

// All on-board card effects, persisted to localStorage and managed from
// /admin/effects.
export const effectsService = new ArrayServiceClass<CardEffect>('effects', DEFAULT_EFFECTS);

// Retired canonical descriptions for shipped presets, by id. A stored preset
// whose description still matches its retired string is refreshed to the current
// default below — this lets a reworded marker effect (e.g. flip) reach browsers
// that persisted the old copy, while leaving any user-edited description alone.
const RETIRED_DESCRIPTIONS: Record<string, string[]> = {
	flip: ['Flip the target']
};

// Reconcile the shipped templates into storage. A session whose localStorage was
// persisted before a template existed would otherwise hydrate to only the old
// set (making the page flash the full list from SSR, then drop to the stale
// one). Any default missing by id is appended; an existing default whose
// description is a known-retired string is refreshed to the current wording.
// User-created and user-edited effects are otherwise left untouched. This runs
// in the browser only, after the store has hydrated from localStorage.
if (typeof window !== 'undefined') {
	for (const preset of DEFAULT_EFFECTS) {
		const existing = effectsService.exists(preset.id);
		if (!existing) {
			effectsService.add(preset);
			continue;
		}
		const retired = RETIRED_DESCRIPTIONS[preset.id];
		if (
			retired &&
			'description' in existing &&
			'description' in preset &&
			retired.includes(existing.description)
		) {
			effectsService.update({ ...existing, description: preset.description });
		}
	}
}
