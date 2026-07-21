import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GENERATED_DIR } from '$lib/server/data-paths';

// Serves a card's baked full-size PNG. `GET /print?id=<cardId>` returns the
// image bytes from static/cards/generated/<id>.png, or 404 when that card has not
// been generated yet. This is what card tiles point an <img> at; a 404 is the
// signal for the owning page to render the card (client-side, throttled — see
// $utils/card/generateQueue) and POST it to /print/save, after which this
// endpoint serves it. Anything unexpected is logged to the dev server console so
// print problems are visible in the backend log. Like the other /admin endpoints
// this is dev tooling and is absent from the static production build.
const DIR = GENERATED_DIR;

export const GET: RequestHandler = async ({ url }) => {
	const rawId = url.searchParams.get('id');

	// Card ids are numeric; reject anything else so the id can't escape DIR.
	if (!rawId || !/^\d+$/.test(rawId)) {
		console.warn(`[admin/print] bad request: id=${JSON.stringify(rawId)}`);
		throw error(400, 'A numeric card id is required.');
	}

	const file = join(DIR, `${rawId}.png`);
	if (!existsSync(file)) {
		// Expected until the card is baked — the tile's queue will generate it. Logged
		// at info so a persistent miss (a card that never bakes) is still traceable.
		console.info(`[admin/print] miss id=${rawId} — not generated yet`);
		throw error(404, `Card ${rawId} has not been generated yet.`);
	}

	try {
		const body = readFileSync(file);
		return new Response(body, {
			headers: {
				'content-type': 'image/png',
				// The file can be (re)written by /print/save, so don't let the
				// browser hold a stale copy across a regeneration.
				'cache-control': 'no-cache'
			}
		});
	} catch (err) {
		console.error(`[admin/print] failed to read ${file}:`, err);
		throw error(500, `Could not read the generated PNG for card ${rawId}.`);
	}
};
