// The card classification rules, shared by every generator in this package.
//
// They used to live inside build-card-catalog.mjs alone. They are here now
// because build-grantable-cards.mjs has to reach the *same* verdict: the catalog
// tells the client which cards are playable, the grantable list tells the client
// and the database which cards may be handed to a player, and the two disagreeing
// is exactly how a player ends up owning a card the game refuses to render.

import { existsSync, readFileSync } from 'fs';

export function categoryOf(type) {
	if (typeof type !== 'string') return 'other';
	if (type.includes('Monster')) return 'monster';
	if (type === 'Spell Card') return 'spell';
	if (type === 'Trap Card') return 'trap';
	return 'other';
}

// Vanilla monsters (Normal / Normal Tuner / Pendulum Normal) and plain Effect
// Monsters are playable on their own; every other card needs an assigned effect.
export function isVanillaMonster(type) {
	return categoryOf(type) === 'monster' && typeof type === 'string' && type.includes('Normal');
}

export function isPlainEffectMonster(type) {
	return type === 'Effect Monster';
}

// Fusion and Ritual monsters (any of their `type` variants — "Fusion Monster",
// "Ritual Monster", "Ritual Effect Monster", "Pendulum Effect Fusion Monster",
// …) are playable on their own, like vanilla and plain Effect Monsters.
export function isFusionOrRitualMonster(type) {
	return (
		categoryOf(type) === 'monster' &&
		typeof type === 'string' &&
		(type.includes('Fusion') || type.includes('Ritual'))
	);
}

// The authoritative playable verdict. `impls` is the card's entry in the effect
// assignments authored on /admin/cards. Everything that isn't playable on its own
// — the gimmick monster subtypes (Toon, Union, Flip, Spirit, Gemini…), spells and
// traps — earns it by having at least one effect implementation assigned.
export function isPlayable(type, impls) {
	return (
		isVanillaMonster(type) ||
		isPlainEffectMonster(type) ||
		isFusionOrRitualMonster(type) ||
		(Array.isArray(impls) && impls.length > 0)
	);
}

// A monster only earns a place in the catalog once it has a billboard cutout
// prepared for the board — there is nothing to render on the field without one.
// Spells, traps, and everything else are always kept regardless of billboard.
export function survivesBillboardGate(card) {
	return categoryOf(card.type) === 'monster' ? Boolean(card.billboard) : true;
}

// Read a JSON object file, treating a missing or malformed file as empty. Used
// for the consumer-authored inputs (effect assignments, board positions), which
// legitimately don't exist on a standalone run of this package.
export function readJsonObject(path) {
	if (!existsSync(path)) return {};
	try {
		const data = JSON.parse(readFileSync(path, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
}
