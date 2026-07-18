import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Emits a trimmed, deploy-ready card catalog that the client filters in the
// browser. The static SPA (GitHub Pages) has no server to run the old
// `/database/cards` endpoints, so the grid/deck/board data flow now reads this
// file directly. Everything the endpoints did — the tile field subset and the
// authoritative `playable` verdict — is precomputed here so dev and prod share
// one code path against one dataset.
//
// Source: the committed static/cards/cardinfo.json (full YGOPRODeck records)
// merged with the effect assignments authored on /admin/cards.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CARDINFO = join(root, 'static/cards/cardinfo.json');
const ASSIGNMENTS = join(root, 'static/card-effects/assignments.json');
const OUT = join(root, 'static/cards/catalog.json');

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

function readEffectAssignments() {
	if (!existsSync(ASSIGNMENTS)) return {};
	try {
		const data = JSON.parse(readFileSync(ASSIGNMENTS, 'utf8'));
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

const cards = raw.data.map((card) => {
	const impls = effects[String(card.id)];
	const playable =
		isVanillaMonster(card.type) ||
		isPlainEffectMonster(card.type) ||
		(Array.isArray(impls) && impls.length > 0);

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
		playable
	};
});

writeFileSync(OUT, JSON.stringify({ cards, generatedAt: new Date().toISOString() }));
console.log(`[build-card-catalog] wrote ${OUT} (${cards.length} cards)`);
