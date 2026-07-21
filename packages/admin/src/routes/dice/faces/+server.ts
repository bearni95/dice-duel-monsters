import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DICE_FACE_COUNT } from '$types/dice.type';
import { GENERATED_DICE_DIR } from '$lib/server/data-paths';

// Write side of the die-face bake. Each face is rasterized full-resolution in the
// browser (see renderDieFace) and POSTed here, one request per face, to be
// persisted under the assets package as dice/generated/<id>-<face>.png. Those PNGs
// are the git-tracked, baked-in face art both the admin and frontend serve. Like
// the other /admin endpoints this is dev tooling, absent from the production build.
const DIR = GENERATED_DICE_DIR;

// Die ids are `${templateId}-r${rarity}` slugs; keep the id filename-safe and the
// face a plain 1..DICE_FACE_COUNT index so neither can escape the target directory.
function resolvePath(rawId: unknown, rawFace: unknown): { name: string; file: string } {
	const id = typeof rawId === 'string' ? rawId.trim() : '';
	if (!id || !/^[a-z0-9-]+$/.test(id)) throw error(400, 'A slug-safe die id is required.');

	const face = Number(rawFace);
	if (!Number.isInteger(face) || face < 1 || face > DICE_FACE_COUNT) {
		throw error(400, `A face between 1 and ${DICE_FACE_COUNT} is required.`);
	}

	const name = `${id}-${face}.png`;
	return { name, file: join(DIR, name) };
}

// Persist one freshly-rendered face PNG. Body is `{ id, face, dataUrl }`, where
// dataUrl is the `data:image/png;base64,…` produced by renderDieFace.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body) throw error(400, 'A JSON body is required.');

	const { name, file } = resolvePath(body.id, body.face);

	const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
	const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
	if (!match) throw error(400, 'A base64 PNG dataUrl is required.');

	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
	const bytes = Buffer.from(match[1], 'base64');
	writeFileSync(file, bytes);
	console.info(`[admin/dice] baked face ${name} (${bytes.length} bytes)`);

	return json({ saved: true, name });
};
