#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Emits a trimmed, deploy-ready card catalog that the client filters in the
// browser. The static SPA (GitHub Pages) has no server to run the old
// `/database/cards` endpoints, so the grid/deck/board data flow now reads this
// file directly. Everything the endpoints did — the tile field subset and the
// authoritative `playable` verdict — is precomputed here so dev and prod share
// one code path against one dataset.
//
// Source: this package's committed cards/cardinfo.json (full YGOPRODeck
// records), merged with two consumer-supplied inputs — the effect assignments
// authored on /admin/cards and the per-card board positioning authored in the
// board-preview modal. The consumer (the frontend) points those, and the
// catalog output, at its own tree via the CARD_CATALOG_* env vars below;
// standalone runs fall back to package-local paths (missing files are treated
// as empty) and emit into this package's dist/.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Relative env paths resolve against the caller's cwd (the frontend package
// root when invoked from its build), so `pnpm --filter frontend build` writes
// the catalog straight into the served static tree.
const fromEnv = (name, fallback) =>
	process.env[name] ? resolve(process.cwd(), process.env[name]) : join(root, fallback);

const CARDINFO = join(root, 'cards/cardinfo.json');
const ASSIGNMENTS = fromEnv('CARD_CATALOG_ASSIGNMENTS', 'card-effects/assignments.json');
const POSITIONS = fromEnv('CARD_CATALOG_POSITIONS', 'cards/positions.json');
const OUT = fromEnv('CARD_CATALOG_OUT', 'dist/catalog.json');

// --- playable classification (mirrors the old +server.ts rules) -------------

function categoryOf(type) {
	if (typeof type !== 'string') return 'other';
	if (type.includes('Monster')) return 'monster';
	if (type === 'Spell Card') return 'spell';
	if (type === 'Trap Card') return 'trap';
	return 'other';
}

// Vanilla monsters (Normal / Normal Tuner / Pendulum Normal) and plain Effect
// Monsters are playable on their own; every other card needs an assigned effect.
function isVanillaMonster(type) {
	return categoryOf(type) === 'monster' && typeof type === 'string' && type.includes('Normal');
}
function isPlainEffectMonster(type) {
	return type === 'Effect Monster';
}
// Fusion and Ritual monsters (any of their `type` variants — "Fusion Monster",
// "Ritual Monster", "Ritual Effect Monster", "Pendulum Effect Fusion Monster",
// …) are playable on their own, like vanilla and plain Effect Monsters.
function isFusionOrRitualMonster(type) {
	return (
		categoryOf(type) === 'monster' &&
		typeof type === 'string' &&
		(type.includes('Fusion') || type.includes('Ritual'))
	);
}

// A monster only earns a place in the catalog once it has a billboard cutout
// prepared for the board — there is nothing to render on the field without one.
// Spells, traps, and everything else are always kept regardless of billboard.
function survivesBillboardGate(card) {
	return categoryOf(card.type) === 'monster' ? Boolean(card.billboard) : true;
}

function readEffectAssignments() {
	if (!existsSync(ASSIGNMENTS)) return {};
	try {
		const data = JSON.parse(readFileSync(ASSIGNMENTS, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
}

// Per-card board positioning authored on /admin/cards
// (`cardId -> { size?, x?, y? }`): a billboard size factor plus an x/y pixel
// offset of the image (its red square) relative to its cell (the purple square).
// Only fields adjusted away from their default (size 1, x/y 0) are stored.
function readPositions() {
	if (!existsSync(POSITIONS)) return {};
	try {
		const data = JSON.parse(readFileSync(POSITIONS, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
}

// --- build ------------------------------------------------------------------

if (!existsSync(CARDINFO)) {
	console.error(`[build-card-catalog] missing ${CARDINFO}`);
	process.exit(1);
}

const raw = JSON.parse(readFileSync(CARDINFO, 'utf8'));
if (!raw || !Array.isArray(raw.data)) {
	console.error('[build-card-catalog] cardinfo.json has no `data` array');
	process.exit(1);
}

const effects = readEffectAssignments();
const positions = readPositions();

const cards = raw.data.filter(survivesBillboardGate).map((card) => {
	const impls = effects[String(card.id)];
	const playable =
		isVanillaMonster(card.type) ||
		isPlainEffectMonster(card.type) ||
		isFusionOrRitualMonster(card.type) ||
		(Array.isArray(impls) && impls.length > 0);

	// Board positioning: only fields adjusted away from their default carry a
	// stored value, so a default card omits `size`/`x`/`y` entirely (the renderer
	// treats a missing size as 1 and a missing offset as 0 — the red and purple
	// borders matching, centered).
	const pos = positions[String(card.id)];
	const size = pos && Number.isFinite(pos.size) ? pos.size : undefined;
	const x = pos && Number.isFinite(pos.x) ? pos.x : undefined;
	const y = pos && Number.isFinite(pos.y) ? pos.y : undefined;

	return {
		id: card.id,
		name: card.name,
		type: card.type,
		race: card.race,
		attribute: card.attribute ?? '',
		cardImages: (card.card_images ?? []).map((i) => ({ image_url_cropped: i.image_url_cropped })),
		billboard: card.billboard,
		atk: card.atk,
		def: card.def,
		lvl: card.level,
		desc: card.desc,
		playable,
		...(size !== undefined ? { size } : {}),
		...(x !== undefined ? { x } : {}),
		...(y !== undefined ? { y } : {})
	};
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ cards, generatedAt: new Date().toISOString() }));
console.log(`[build-card-catalog] wrote ${OUT} (${cards.length} cards)`);
