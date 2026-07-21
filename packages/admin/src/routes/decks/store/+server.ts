import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	unlinkSync
} from 'fs';
import { join } from 'path';
import { DECKS_DIR } from '$lib/server/data-paths';

// Saved decks are persisted as JSON files in the data package's `decks/` — one
// file per deck (`<id>.json`) plus a regenerated `manifest.json` aggregate the
// client reads in a single request. The files are the source of truth and this
// endpoint is the dev-time authoring surface that writes them; the frontend
// serves (or syncs) them from the same data package.
const DIR = DECKS_DIR;
const MANIFEST = join(DIR, 'manifest.json');
const ASSIGNMENTS = join(DIR, 'assignments.json');
// Aggregate/index files that live alongside the per-deck files but aren't decks.
const RESERVED = new Set(['manifest.json', 'assignments.json']);

interface Deck {
	id: string;
	name: string;
	main: number[];
	extra: number[];
	side: number[];
	// Card ids the owner toggled off in the deck editor; filtered out of the
	// playable views. Absent/empty means every card is enabled.
	disabled: number[];
	// Card ids the owner forced on despite being flagged not playable; included in
	// the playable views. The inverse of `disabled`.
	forced: number[];
}

// Lowercase, ASCII, hyphen-separated. Used both to derive a filename from a deck
// name and to sanitise any incoming id, which keeps writes/deletes inside DIR.
function slugify(value: string): string {
	return (
		value
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'deck'
	);
}

function ensureDir(): void {
	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

function numberArray(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
}

// Read every per-deck file back into memory, skipping the aggregate files.
function readDecks(): Deck[] {
	ensureDir();
	return readdirSync(DIR)
		.filter((f) => f.endsWith('.json') && !RESERVED.has(f))
		.map((f) => {
			try {
				return JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Deck;
			} catch {
				return null;
			}
		})
		.filter((d): d is Deck => !!d && typeof d.id === 'string' && typeof d.name === 'string')
		.sort((a, b) => a.name.localeCompare(b.name));
}

function writeManifest(decks: Deck[]): void {
	writeFileSync(MANIFEST, `${JSON.stringify(decks, null, 2)}\n`);
}

// Drop any character→deck assignment pointing at a now-deleted deck.
function purgeAssignments(deckId: string): void {
	if (!existsSync(ASSIGNMENTS)) return;
	let map: Record<string, string>;
	try {
		map = JSON.parse(readFileSync(ASSIGNMENTS, 'utf8'));
	} catch {
		return;
	}
	let changed = false;
	for (const [slug, id] of Object.entries(map)) {
		if (id === deckId) {
			delete map[slug];
			changed = true;
		}
	}
	if (changed) writeFileSync(ASSIGNMENTS, `${JSON.stringify(map, null, 2)}\n`);
}

export const GET: RequestHandler = async () => json({ decks: readDecks() });

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.name !== 'string' || !body.name.trim()) {
		throw error(400, 'A deck name is required.');
	}
	ensureDir();

	const name = body.name.trim();
	const main = numberArray(body.main);
	const extra = numberArray(body.extra);
	const side = numberArray(body.side);
	// Keep only ids that actually belong to the deck, de-duplicated, so a stale
	// toggle can't leave orphan ids in the disabled/forced lists.
	const deckIds = new Set([...main, ...extra, ...side]);
	const disabled = [...new Set(numberArray(body.disabled))].filter((id) => deckIds.has(id));
	const forced = [...new Set(numberArray(body.forced))].filter((id) => deckIds.has(id));

	// Editing an existing deck reuses its id/file; a new deck derives a unique
	// slug from its name so the files stay human-readable.
	let id = typeof body.id === 'string' && body.id ? slugify(body.id) : '';
	if (!id) {
		const base = slugify(name);
		id = base;
		let n = 2;
		while (existsSync(join(DIR, `${id}.json`))) id = `${base}-${n++}`;
	}

	const deck: Deck = { id, name, main, extra, side, disabled, forced };
	writeFileSync(join(DIR, `${id}.json`), `${JSON.stringify(deck, null, 2)}\n`);
	writeManifest(readDecks());
	return json({ deck });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const rawId = url.searchParams.get('id');
	if (!rawId) throw error(400, 'A deck id is required.');
	const id = slugify(rawId);
	const file = join(DIR, `${id}.json`);
	if (existsSync(file)) unlinkSync(file);
	purgeAssignments(id);
	writeManifest(readDecks());
	return json({ ok: true });
};
