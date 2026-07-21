import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import type { CardDetail } from '$types/card.type';

// Full YGOPRODeck records live in the card-data package now.
const CARDINFO = createRequire(import.meta.url).resolve('card-data/data/cards/cardinfo.json');

// Returns the complete card record for a single id, with every field available
// in the source data — unlike the grid endpoint, which returns only the subset
// needed to render tiles. Powers the card detail modal.
export const GET: RequestHandler = async ({ params }) => {
	const id = parseInt(params.id ?? '', 10);
	if (!Number.isFinite(id)) throw error(400, 'Invalid card id');

	const raw: { data: unknown } | null = existsSync(CARDINFO)
		? JSON.parse(readFileSync(CARDINFO, 'utf8'))
		: null;

	if (!raw || !raw.data || !Array.isArray(raw.data))
		throw error(503, 'Cards data not found — check card-data/data/cards/cardinfo.json');

	const card = (raw.data as CardDetail[]).find((c) => c.id === id);
	if (!card) throw error(404, `Card ${id} not found`);

	return json({ card });
};
