import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GENERATED_DIR } from '$lib/server/data-paths';

// Write side of the /admin/print PNG cache. A card is rasterized in the browser
// (see renderCardToPng / generateQueue), which is expensive and non-deterministic;
// the bitmap is POSTed here and persisted under static/cards/generated/<id>.png,
// which GET /admin/print then serves directly. These files are committed to git —
// they are the authored, baked-in art for each card. Like the other /admin
// endpoints this is dev tooling and is absent from the static production build.
const DIR = GENERATED_DIR;

// Card ids are numeric; restrict to digits so the id can't escape the target
// directory when composing the file path.
function resolvePath(rawId: string | null): { id: string; file: string } {
	if (!rawId || !/^\d+$/.test(rawId)) throw error(400, 'A numeric card id is required.');
	return { id: rawId, file: join(DIR, `${rawId}.png`) };
}

// Persist a freshly-rendered PNG. Body is `{ id, dataUrl, failedAssets? }`, where
// dataUrl is the `data:image/png;base64,…` produced by renderCardToPng and
// failedAssets lists any card art/icons that could not be inlined.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) throw error(400, 'A JSON body is required.');

	const { id, file } = resolvePath(body.id != null ? String(body.id) : null);

	const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
	const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
	if (!match) throw error(400, 'A base64 PNG dataUrl is required.');

	// Never bake a card whose art or icons failed to inline — a blank PNG here would
	// be served (and committed) forever. Log why and refuse; the tile keeps its
	// placeholder and the card is retried on a later load, under lighter contention.
	const failedAssets = Array.isArray(body.failedAssets) ? body.failedAssets : [];
	if (failedAssets.length > 0) {
		console.warn(
			`[admin/print] refusing to bake card ${id}: ${failedAssets.length} asset(s) ` +
				`failed to inline → ${failedAssets.join(', ')}`
		);
		return json({ saved: false, failedAssets });
	}

	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
	const bytes = Buffer.from(match[1], 'base64');
	writeFileSync(file, bytes);
	console.info(`[admin/print] baked card ${id} (${bytes.length} bytes)`);

	return json({ saved: true, url: `/admin/print?id=${id}` });
};
