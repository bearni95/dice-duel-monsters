import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DICE_FACE_COUNT } from '$types/dice.type';
import { GENERATED_DICE_DIR } from '$lib/server/data-paths';

// Write side of the die-face bake. Every face of every die is rasterized
// full-resolution in the browser (see renderDieFace) and the whole batch is POSTed
// here in one request, to be persisted under the assets package as
// dice/generated/<id>-<face>.png. Those PNGs are the git-tracked, baked-in face art
// both the admin and frontend serve. Like the other /admin endpoints this is dev
// tooling, absent from the production build.
const DIR = GENERATED_DICE_DIR;

// Die ids are `${templateId}-r${rarity}` slugs; keep the id filename-safe and the
// face a plain 1..DICE_FACE_COUNT index so neither can escape the target directory.
function resolveName(rawId: unknown, rawFace: unknown): string {
	const id = typeof rawId === 'string' ? rawId.trim() : '';
	if (!id || !/^[a-z0-9-]+$/.test(id)) throw error(400, 'A slug-safe die id is required.');

	const face = Number(rawFace);
	if (!Number.isInteger(face) || face < 1 || face > DICE_FACE_COUNT) {
		throw error(400, `A face between 1 and ${DICE_FACE_COUNT} is required.`);
	}
	return `${id}-${face}.png`;
}

function decode(dataUrl: unknown): Buffer {
	const url = typeof dataUrl === 'string' ? dataUrl : '';
	const match = url.match(/^data:image\/png;base64,(.+)$/);
	if (!match) throw error(400, 'A base64 PNG dataUrl is required for every face.');
	return Buffer.from(match[1], 'base64');
}

// Persist a full batch of freshly-rendered faces. Body is `{ faces: [{ id, face,
// dataUrl }] }`, where each dataUrl is a `data:image/png;base64,…` from renderDieFace.
// Every entry is validated before anything is written, so a bad face fails the whole
// request rather than leaving a half-baked set on disk.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const list = body && Array.isArray(body.faces) ? body.faces : null;
	if (!list || list.length === 0) throw error(400, 'A non-empty `faces` array is required.');

	const writes = list.map((entry: Record<string, unknown>) => ({
		name: resolveName(entry?.id, entry?.face),
		bytes: decode(entry?.dataUrl)
	}));

	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
	for (const { name, bytes } of writes) writeFileSync(join(DIR, name), bytes);
	console.info(`[admin/dice] baked ${writes.length} face PNG(s)`);

	return json({ saved: writes.length });
};
