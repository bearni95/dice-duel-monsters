import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { CardEffectImplementation } from '$types/card-effect.type';
import { CARD_EFFECTS } from '$lib/server/data-paths';

// Which effect templates each card implements, persisted as a single static JSON
// map (`cardId -> implementations[]`) alongside the card assets. Edited from
// /admin/cards (the effects modal) and read at runtime as a static asset. The
// card catalog itself stays read-only; only these per-card assignments live here.
const FILE = CARD_EFFECTS;
const DIR = dirname(FILE);

type EffectsMap = Record<string, CardEffectImplementation[]>;

function read(): EffectsMap {
	if (!existsSync(FILE)) return {};
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? (data as EffectsMap) : {};
	} catch {
		return {};
	}
}

export const GET: RequestHandler = async () => json(read());

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || (typeof body.cardId !== 'string' && typeof body.cardId !== 'number')) {
		throw error(400, 'A cardId is required.');
	}
	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

	const cardId = String(body.cardId);
	const implementations = Array.isArray(body.implementations) ? body.implementations : [];

	const map = read();
	// An empty implementations list clears the card's entry so storage doesn't
	// accumulate empty records; otherwise replace it wholesale.
	if (implementations.length) {
		map[cardId] = implementations;
	} else {
		delete map[cardId];
	}
	writeFileSync(FILE, `${JSON.stringify(map, null, 2)}\n`);
	return json(map);
};
