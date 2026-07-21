import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { DEFAULT_SPELLS, type SpellDefinition, type SpellCardRef } from '$types/spell.type';
import { SPELLS_FILE } from '$lib/server/data-paths';

// The six board spells, persisted as a single JSON array under `static/spells/` —
// the source of truth the game reads at runtime, and this endpoint is the
// dev-time authoring surface that writes it (mirroring how card effects, decks and
// dice persist their JSON under static/). Only editable fields (name, description)
// and the associated magic/trap card live here; the canonical set of spell keys is
// fixed in DEFAULT_SPELLS.
const FILE = SPELLS_FILE;
const DIR = dirname(FILE);

function readStored(): SpellDefinition[] {
	if (!existsSync(FILE)) return [];
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return Array.isArray(data) ? (data as SpellDefinition[]) : [];
	} catch {
		return [];
	}
}

// Merge stored edits over the canonical defaults, keyed by spell key, so the six
// spells always exist (a newly added default surfaces even before it is saved) and
// any stored name/description/card override wins.
function read(): SpellDefinition[] {
	const stored = new Map(readStored().map((s) => [s.key, s]));
	return DEFAULT_SPELLS.map((base) => {
		const override = stored.get(base.key);
		return override ? { ...base, ...override, key: base.key } : { ...base };
	});
}

// Coerce arbitrary input into a valid card reference, or null when absent/invalid.
function sanitizeCard(value: unknown): SpellCardRef | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const id = Number(raw.id);
	if (!Number.isFinite(id)) return null;
	return { id, name: typeof raw.name === 'string' ? raw.name : String(raw.name ?? '') };
}

export const GET: RequestHandler = async () => json({ spells: read() });

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const incoming = Array.isArray(body?.spells) ? (body.spells as unknown[]) : null;
	if (!incoming) throw error(400, 'A spells array is required.');
	if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

	// Index the incoming edits by key, then rebuild from the canonical defaults so
	// the stored file always holds exactly the six spells with clean fields —
	// unknown keys are ignored and missing ones fall back to their default copy.
	const byKey = new Map<string, Record<string, unknown>>();
	for (const item of incoming) {
		if (item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string') {
			byKey.set((item as { key: string }).key, item as Record<string, unknown>);
		}
	}

	const spells: SpellDefinition[] = DEFAULT_SPELLS.map((base) => {
		const edit = byKey.get(base.key);
		if (!edit) return { ...base };
		return {
			key: base.key,
			name: typeof edit.name === 'string' && edit.name.trim() ? edit.name.trim() : base.name,
			description:
				typeof edit.description === 'string' ? edit.description.trim() : base.description,
			card: sanitizeCard(edit.card)
		};
	});

	writeFileSync(FILE, `${JSON.stringify(spells, null, 2)}\n`);
	return json({ spells });
};
