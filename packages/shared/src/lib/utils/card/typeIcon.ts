// Map a card's monster `race` (Aqua, Beast, Dragon, …) to its Master Duel type
// icon, downloaded by scripts/import-type-icons.mjs into static/assets/types/.
//
// The icons are stored under a normalized slug — lowercased with every
// non-alphanumeric character stripped — so the icon file names (`BeastWarrior`,
// `SeaSerpent`) and the raw card `race` strings (`Beast-Warrior`, `Sea Serpent`)
// collapse to the same key. Only the 25 monster types have icons; spell/trap
// races (Continuous, Equip, Quick-Play, …) and character names resolve to null so
// callers can fall back to plain text.
const KNOWN_TYPE_SLUGS = new Set([
	'aqua',
	'beast',
	'beastwarrior',
	'creatorgod',
	'cyberse',
	'dinosaur',
	'divinebeast',
	'dragon',
	'fairy',
	'fiend',
	'fish',
	'illusion',
	'insect',
	'machine',
	'plant',
	'psychic',
	'pyro',
	'reptile',
	'rock',
	'seaserpent',
	'spellcaster',
	'thunder',
	'warrior',
	'wingedbeast',
	'wyrm',
	'zombie'
]);

// Returns the type-icon path for a monster's race, or null when the race is
// absent or isn't one of the known monster types (spells, traps, character
// cards), in which case callers keep rendering the race as text.
export function typeIcon(race: string | null | undefined): string | null {
	if (!race) return null;
	const slug = race.toLowerCase().replace(/[^a-z0-9]/g, '');
	return KNOWN_TYPE_SLUGS.has(slug) ? `/assets/types/${slug}.png` : null;
}
