// The six board spells. Each is found on the board and rolls 1d6 when picked up,
// producing an X value that scales its effect (see the seed descriptions below).
// A spell can be associated with a magic or trap card from the catalog — the card
// that visually represents it in game — which the /spells admin page edits.

// A reference to the magic/trap card a spell is represented by. Kept minimal (id +
// name) so the stored JSON stays small; the full asset is re-resolved from the
// catalog for display.
export interface SpellCardRef {
	id: number;
	name: string;
}

// A single spell definition, persisted as editable JSON. `key` is the stable
// identifier used as the storage/list key; `name` and `description` are the
// human-facing copy; `card` is the associated magic/trap card, or null when none
// has been assigned yet.
export interface SpellDefinition {
	key: string;
	name: string;
	description: string;
	card: SpellCardRef | null;
}

// The canonical six spells, seeded when no stored data exists yet. Each rolls 1d6
// on pickup for its X value (see spells.md). Card associations start empty and are
// assigned from the /spells admin page.
export const DEFAULT_SPELLS: SpellDefinition[] = [
	{
		key: 'trap-hole',
		name: 'Trap Hole',
		description: 'Hide a trap on 1d6 red cells, callable on your turn.',
		card: null
	},
	{
		key: 'shield',
		name: 'Shield +1',
		description: 'Distribute 1d6 points of extra shield, up to 6.',
		card: null
	},
	{
		key: 'sword',
		name: 'Sword +1',
		description: 'Distribute 1d6 points of extra attack, no limit.',
		card: null
	},
	{
		key: 'field',
		name: 'Field Card +X',
		description:
			'All monsters with the chosen attribute or type gain +1 ATK, +2 ATK and +1 DEF.',
		card: null
	},
	{
		key: 'wings',
		name: 'Wings',
		description:
			'Distribute the flying attribute to 1d6/2 (round up) monsters, letting them fly over creatures and empty cells.',
		card: null
	},
	{
		key: 'energy',
		name: 'Energy',
		description: 'Gain the d6 roll in energy.',
		card: null
	}
];
