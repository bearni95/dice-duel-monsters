import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { DiceDefinition, DiceFace } from '$types/dice.type';
import { DICE_FACE_COUNT } from '$types/dice.type';

// Die definitions are persisted as a single JSON array under `static/dice/` —
// the source of truth the game reads at runtime, and this endpoint is the
// dev-time authoring surface that writes it (mirroring how card effects and
// decks persist their JSON under static/). The card catalog stays read-only;
// only these die definitions live here and are edited from /admin/dice.
const FILE = join(process.cwd(), 'static/dice/dice.json');

// Lowercase, ASCII, hyphen-separated. Derives a filename-safe id from a die name
// and sanitises any incoming id so it stays a stable, readable key.
function slugify(value: string): string {
	return (
		value
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'die'
	);
}

function read(): DiceDefinition[] {
	if (!existsSync(FILE)) return [];
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return Array.isArray(data) ? (data as DiceDefinition[]) : [];
	} catch {
		return [];
	}
}

function write(dice: DiceDefinition[]): void {
	const dir = dirname(FILE);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(FILE, `${JSON.stringify(dice, null, 2)}\n`);
}

// Coerce arbitrary request input into exactly six clean faces: a string icon and
// a string value each, padding short lists and truncating long ones so a stored
// die always has DICE_FACE_COUNT faces.
function sanitizeFaces(value: unknown): DiceFace[] {
	const list = Array.isArray(value) ? value : [];
	const faces: DiceFace[] = [];
	for (let i = 0; i < DICE_FACE_COUNT; i++) {
		const raw = (list[i] ?? {}) as Record<string, unknown>;
		faces.push({
			icon: typeof raw.icon === 'string' ? raw.icon.trim() : '',
			value: typeof raw.value === 'string' ? raw.value.trim() : String(raw.value ?? '')
		});
	}
	return faces;
}

export const GET: RequestHandler = async () => json({ dice: read() });

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.name !== 'string' || !body.name.trim()) {
		throw error(400, 'A die name is required.');
	}

	const name = body.name.trim();
	const color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : undefined;
	const faces = sanitizeFaces(body.faces);
	const dice = read();

	// Editing reuses the existing id; a new die derives a unique slug from its name
	// so the stored ids stay human-readable and collision-free.
	let id = typeof body.id === 'string' && body.id ? slugify(body.id) : '';
	if (!id) {
		const base = slugify(name);
		id = base;
		let n = 2;
		while (dice.some((d) => d.id === id)) id = `${base}-${n++}`;
	}

	const die: DiceDefinition = { id, name, ...(color ? { color } : {}), faces };
	const index = dice.findIndex((d) => d.id === id);
	if (index >= 0) dice[index] = die;
	else dice.push(die);

	write(dice);
	return json({ die });
};

export const DELETE: RequestHandler = async ({ url }) => {
	const rawId = url.searchParams.get('id');
	if (!rawId) throw error(400, 'A die id is required.');
	const id = slugify(rawId);
	write(read().filter((d) => d.id !== id));
	return json({ ok: true });
};
