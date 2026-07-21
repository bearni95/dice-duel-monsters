import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { YgoProDeckApiDeck } from '$types/ygoprodeck.type';

// Community deck search lives on ygoprodeck.com, which does not send CORS
// headers, so the browser can't call it directly. We proxy the request through
// this server route (server-side fetch has no CORS restriction), mirroring the
// pattern used by /database/cards.
const BASE_URL = 'https://ygoprodeck.com/api/decks/getDecks.php';

export const GET: RequestHandler = async ({ url, fetch }) => {
	const name = url.searchParams.get('name')?.trim();
	const format = url.searchParams.get('format')?.trim();
	const limit = url.searchParams.get('limit');
	const offset = url.searchParams.get('offset');

	const upstream = new URL(BASE_URL);
	if (name) upstream.searchParams.set('name', name);
	if (format) upstream.searchParams.set('_sft_category', format);
	if (limit) upstream.searchParams.set('limit', limit);
	if (offset) upstream.searchParams.set('offset', offset);

	let res: Response;
	try {
		res = await fetch(upstream.toString());
	} catch {
		throw error(502, 'Could not reach the deck search service.');
	}

	// The endpoint answers "no matches" with a 400 + { error } body rather than
	// an empty list, so a fruitless search should read as empty results, not a
	// failure. Any other non-ok status is a genuine error worth surfacing.
	if (!res.ok && res.status !== 400) {
		throw error(res.status, `Deck search failed (${res.status}).`);
	}

	const data: unknown = await res.json().catch(() => null);

	// A successful search returns an array of decks; a no-match search returns an
	// object (e.g. { error: ... }). Normalise both to an array.
	const decks: YgoProDeckApiDeck[] = Array.isArray(data) ? (data as YgoProDeckApiDeck[]) : [];

	return json({ decks });
};
