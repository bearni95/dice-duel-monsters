import type { ID } from '$types/core.type';

// A single face of a six-sided die: the SVG icon painted on it and the value it
// scores when rolled. `value` is free text so a face can carry a multiplier
// ("x2"), a number, or a short label — it renders as the face's corner badge.
export interface DiceFace {
	icon: string; // URL under /assets/icons/…
	value: string;
}

// A named, editable die definition, persisted as JSON under static/dice. A die
// always has exactly six faces, in face order (index 0 => face 1 … index 5 =>
// face 6). `color` is an optional hex tint ("#d7382f") for the die body.
export interface DiceDefinition {
	id: ID;
	name: string;
	color?: string;
	faces: DiceFace[];
}

// Number of faces on a standard die; every definition carries exactly this many.
export const DICE_FACE_COUNT = 6;

// --- Templates -------------------------------------------------------------
//
// The game's dice are not hand-authored one by one — they are spawned from a
// small set of templates crossed with a rarity level. A template describes a die
// *type* (Move / Summon / Attack) by the role each of its six faces plays; a
// rarity (1..6) then fixes the die's colour and the numeric value on each face.
// The whole template config is what we keep in static/dice/templates.json.

// The three actions a die face can carry, each mapped to an icon.
export type DiceRole = 'move' | 'summon' | 'attack';

export interface DiceRoleConfig {
	label: string;
	icon: string; // URL under /assets/icons/…
}

// One face of a template: which role's icon it shows, and whether its rolled
// value is the rarity level (bump=false) or the rarity level + 1 (bump=true).
export interface DiceTemplateFace {
	role: DiceRole;
	bump: boolean;
}

// A die type. `role` is its primary action (the one it's named after); its six
// faces are weighted toward that role, with the other two roles filling the rest.
export interface DiceTemplate {
	id: string;
	name: string;
	role: DiceRole;
	faces: DiceTemplateFace[];
}

// The complete template config: the role→icon map, the six rarity colours (in
// gay-pride flag order, so rarity 1 = red … rarity 6 = violet), and the templates.
export interface DiceTemplateConfig {
	roles: Record<DiceRole, DiceRoleConfig>;
	rarityColors: string[];
	templates: DiceTemplate[];
}

// Rarity runs 1..6, one level per pride-flag colour.
export const DICE_RARITY_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type DiceRarity = (typeof DICE_RARITY_LEVELS)[number];

// A side's energy, split into one pool per die role. Each turn-start dice roll
// feeds the pool matching each landed face's role, and each action spends the
// pool of its own kind: summoning from `summon`, moving from `move`, attacking
// from `attack`.
export type EnergyPools = Record<DiceRole, number>;

// A fresh, empty set of energy pools.
export function emptyEnergyPools(): EnergyPools {
	return { move: 0, summon: 0, attack: 0 };
}

// A concrete die produced by spawning a template at a rarity: a full
// DiceDefinition plus the template/role/rarity it came from, for grouping and
// labelling in the UI.
export interface SpawnedDie extends Omit<DiceDefinition, 'id'> {
	// Deterministic `${templateId}-r${rarity}` id, so it's always a string.
	id: string;
	templateId: string;
	role: DiceRole;
	rarity: number;
}

// One of a die's distinct faces (its six faces deduped by icon+value): the 1-based
// index of the face's first occurrence — so its baked PNG `<id>-<face>.png` can be
// shown — the icon/value it carries, and how many of the six faces share it. A
// `count` above 1 marks a duplicated face.
export interface DistinctFace {
	face: number;
	icon: string;
	value: string;
	count: number;
}

// One cell of the inventory grid: a concrete die (type × rarity), how many copies
// the player owns, and the distinct faces that die rolls.
export interface OwnedDiceCell {
	dieId: string;
	count: number;
	faces: DistinctFace[];
}

// A player's owned dice tallied into a rarity-by-type grid for the inventory
// table: `templates` are the columns, `rarities` the rows, and `rows[i].cells[j]`
// is the die (with its owned count and distinct faces) for `templates[j]` at
// `rarities[i]`.
export interface OwnedDiceGrid {
	templates: DiceTemplate[];
	rarities: number[];
	rows: { rarity: number; cells: OwnedDiceCell[] }[];
}
