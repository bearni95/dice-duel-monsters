import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Which saved deck each character is assigned, persisted as a single static JSON
// map (`characterSlug -> deckId`) alongside the per-deck files. Edited from
// /admin/characters and read at runtime as a static asset.
const DIR = join(process.cwd(), 'static/decks');
const FILE = join(DIR, 'assignments.json');

function read(): Record<string, string> {
	if (!existsSync(FILE)) return {};
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
}

export const GET: RequestHandler = async () => json(read());

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.characterSlug !== 'string' || !body.characterSlug) {
		throw error(400, 'A characterSlug is required.');
	}
	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

	const map = read();
	// An empty/null deckId clears the assignment; otherwise set it.
	if (body.deckId && typeof body.deckId === 'string') {
		map[body.characterSlug] = body.deckId;
	} else {
		delete map[body.characterSlug];
	}
	writeFileSync(FILE, `${JSON.stringify(map, null, 2)}\n`);
	return json(map);
};
