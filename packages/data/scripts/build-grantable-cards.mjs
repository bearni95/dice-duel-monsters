#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import {
	categoryOf,
	isPlayable,
	survivesBillboardGate,
	readJsonObject
} from './lib/card-rules.mjs';

// Emits the authoritative list of card ids a player may ever be granted.
//
// A card is grantable only when *every* condition below holds, because failing
// any one of them produces a card the game cannot show:
//
//   1. it appears in a saved deck, and isn't disabled there — the game's card
//      pool is deck-derived, so a card outside every deck is not in the game;
//   2. it is a monster (spells and traps aren't ownable) with a billboard
//      cutout, or it has nothing to render on the board;
//   3. it is `playable` by the shared card rules — a vanilla / plain Effect /
//      Fusion / Ritual monster, or one with an effect implementation assigned;
//   4. its full-size PNG has actually been baked and committed to the assets
//      package. This is the condition that used to be *assumed* rather than
//      checked: the shipped SPA renders a card only from that committed bitmap
//      (GeneratedCardImage), so granting an unbaked card put a permanent "card
//      not found" placeholder in the player's collection.
//
// Two consumers read the result, and they must agree:
//   * the frontend, via the JSON manifest (`CARD_GRANTABLE_OUT`), which both
//     narrows the drawable pool and filters what the collection renders;
//   * Supabase, via the SQL emitted by `--sql`, which syncs the `available_cards`
//     allow-list that `player_cards` keys off. That is the only one a tampered
//     client can't route around.
//
// Usage:
//   build-grantable-cards [--migrations <dir>]
//   CARD_GRANTABLE_OUT=<path>   where to write the JSON manifest
//                               (default: this package's dist/grantable-cards.json)
//
// `--migrations` emits a timestamped `*_sync_available_cards.sql` into a Supabase
// migrations directory, but only when the set has actually changed since the last
// one — so re-running it after an unrelated build doesn't pile up no-op migrations.

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Relative env paths resolve against the caller's cwd (the frontend package root
// when invoked from its build), matching build-card-catalog.
const fromEnv = (name, fallback) =>
	process.env[name] ? resolve(process.cwd(), process.env[name]) : join(root, fallback);

const CARDINFO = join(root, 'cards/cardinfo.json');
const ASSIGNMENTS = fromEnv('CARD_GRANTABLE_ASSIGNMENTS', 'card-effects/assignments.json');
const DECKS = join(root, 'decks');
const OUT = fromEnv('CARD_GRANTABLE_OUT', 'dist/grantable-cards.json');

// The baked PNGs live in the assets package, which owns them; resolved through
// the workspace dependency rather than by repo layout so this keeps working
// wherever the script is run from.
const ASSETS_ROOT = dirname(require.resolve('assets/package.json'));
const GENERATED = join(ASSETS_ROOT, 'cards', 'generated');

// Deck files that aren't decks: the index of them, and the character→deck map.
const NON_DECK_FILES = new Set(['manifest.json', 'assignments.json']);

// --- inputs -----------------------------------------------------------------

if (!existsSync(CARDINFO)) {
	console.error(`[build-grantable-cards] missing ${CARDINFO}`);
	process.exit(1);
}

const raw = JSON.parse(readFileSync(CARDINFO, 'utf8'));
if (!raw || !Array.isArray(raw.data)) {
	console.error('[build-grantable-cards] cardinfo.json has no `data` array');
	process.exit(1);
}

const effects = readJsonObject(ASSIGNMENTS);

// The union of every saved deck's enabled card ids — the same set the client
// derives via enabledCardIds(): a deck's main + extra + side, minus the ids its
// owner switched off in the deck editor. `forced` is deliberately ignored, as it
// is in the client's pool: forcing a card on shows it in one deck's preview, it
// does not make the card grantable.
function deckCardIds() {
	if (!existsSync(DECKS)) return new Set();
	const ids = new Set();
	for (const file of readdirSync(DECKS)) {
		if (!file.endsWith('.json') || NON_DECK_FILES.has(file)) continue;
		let deck;
		try {
			deck = JSON.parse(readFileSync(join(DECKS, file), 'utf8'));
		} catch {
			console.warn(`[build-grantable-cards] skipping unreadable deck ${file}`);
			continue;
		}
		const off = new Set(Array.isArray(deck.disabled) ? deck.disabled : []);
		for (const key of ['main', 'extra', 'side']) {
			for (const id of Array.isArray(deck[key]) ? deck[key] : []) {
				if (!off.has(id)) ids.add(id);
			}
		}
	}
	return ids;
}

// The card ids with a committed full-size PNG. This is read from the filesystem
// on purpose — the files themselves are the only honest answer to "can this card
// be rendered", and any flag standing in for them is a guess that drifts.
function bakedCardIds() {
	if (!existsSync(GENERATED)) return new Set();
	const ids = new Set();
	for (const file of readdirSync(GENERATED)) {
		const match = file.match(/^(\d+)\.png$/);
		if (match) ids.add(Number(match[1]));
	}
	return ids;
}

// --- build ------------------------------------------------------------------

const inDecks = deckCardIds();
const baked = bakedCardIds();

const rejected = { notInDeck: 0, notMonster: 0, noBillboard: 0, notPlayable: 0, notBaked: 0 };
const grantable = [];

for (const card of raw.data) {
	if (!inDecks.has(card.id)) {
		rejected.notInDeck++;
		continue;
	}
	if (categoryOf(card.type) !== 'monster') {
		rejected.notMonster++;
		continue;
	}
	if (!survivesBillboardGate(card)) {
		rejected.noBillboard++;
		continue;
	}
	if (!isPlayable(card.type, effects[String(card.id)])) {
		rejected.notPlayable++;
		continue;
	}
	if (!baked.has(card.id)) {
		rejected.notBaked++;
		continue;
	}
	grantable.push(card.id);
}

grantable.sort((a, b) => a - b);

if (grantable.length === 0) {
	// An empty pool would leave every player unable to draw anything, and would
	// empty the database allow-list on the next push. Far more likely a broken
	// input than a real answer, so refuse rather than emit it.
	console.error('[build-grantable-cards] refusing to emit an empty grantable set');
	process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ cardIds: grantable, generatedAt: new Date().toISOString() }));

console.log(
	`[build-grantable-cards] wrote ${OUT} (${grantable.length} grantable of ${inDecks.size} deck cards; ` +
		`dropped ${rejected.notMonster} spell/trap, ${rejected.noBillboard} without a billboard, ` +
		`${rejected.notPlayable} not playable, ${rejected.notBaked} without baked art)`
);

// --- optional Supabase allow-list migration ---------------------------------

// The body every sync migration shares: replace the allow-list wholesale inside
// one transaction. Deleting first is what makes a card whose art was removed stop
// being grantable; the `player_cards` FK then makes that deletion fail loudly if
// somebody still owns it, rather than silently leaving an unrenderable card in a
// collection. Also exported into the initial `available_cards` migration.
function syncStatements(ids) {
	const array = `array[${ids.join(',')}]::bigint[]`;
	return [
		'delete from public.available_cards',
		`where card_id <> all (${array});`,
		'',
		'insert into public.available_cards (card_id)',
		`select unnest(${array})`,
		'on conflict (card_id) do nothing;'
	].join('\n');
}

const migrationsFlag = process.argv.indexOf('--migrations');
if (migrationsFlag !== -1) {
	const dirArg = process.argv[migrationsFlag + 1];
	if (!dirArg) {
		console.error('[build-grantable-cards] --migrations needs a directory');
		process.exit(1);
	}
	const migrationsDir = resolve(process.cwd(), dirArg);
	const statements = syncStatements(grantable);

	// Skip when the newest migration that touches the allow-list already states
	// this exact set, so an unrelated rebuild doesn't leave a no-op migration
	// behind for someone to push.
	const previous = existsSync(migrationsDir)
		? readdirSync(migrationsDir)
				.filter(
					(f) => f.endsWith('_available_cards.sql') || f.endsWith('_sync_available_cards.sql')
				)
				.sort()
				.pop()
		: undefined;
	if (previous && readFileSync(join(migrationsDir, previous), 'utf8').includes(statements)) {
		console.log(
			`[build-grantable-cards] allow-list unchanged since ${previous} — no migration written`
		);
	} else {
		const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
		const target = join(migrationsDir, `${stamp}_sync_available_cards.sql`);
		const body = [
			'-- Generated by `pnpm --filter data gen:grantable` — do not edit by hand.',
			'-- Re-syncs the allow-list of card ids a player may be granted with the cards',
			'-- that actually have committed art. Regenerate and push after baking cards.',
			'',
			statements,
			''
		].join('\n');
		mkdirSync(migrationsDir, { recursive: true });
		writeFileSync(target, body);
		console.log(`[build-grantable-cards] wrote ${target} (${grantable.length} allow-listed ids)`);
	}
}
