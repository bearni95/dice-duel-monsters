import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { DEFAULT_SPELLS, type SpellDefinition } from '$types/spell.type';

// The six board spells, persisted as a single static JSON file under
// `static/spells/` (see the /spells/store endpoint) and edited from the /spells
// admin page. Reads come from the static file so the shipped game can load it with
// no server; writes go through the admin endpoint. The canonical set of spell keys
// is fixed in DEFAULT_SPELLS, over which stored edits (name, description, card) are
// merged, so the six spells always exist regardless of the stored file's state.
const SPELLS_URL = '/spells/spells.json';
const ENDPOINT = '/spells/store';

// Reactive mirror of the six spells, seeded with the defaults until loaded.
export const spells = writable<SpellDefinition[]>(DEFAULT_SPELLS.map((s) => ({ ...s })));

let loaded = false;

// Merge stored spells over the canonical defaults, keyed by spell key, so every
// spell always resolves and any stored override wins.
function merge(stored: SpellDefinition[]): SpellDefinition[] {
	const byKey = new Map(stored.map((s) => [s.key, s]));
	return DEFAULT_SPELLS.map((base) => {
		const override = byKey.get(base.key);
		return override ? { ...base, ...override, key: base.key } : { ...base };
	});
}

/** Reload the spells from the static file, merged over the defaults. */
export async function refreshSpells(): Promise<SpellDefinition[]> {
	if (!browser) return get(spells);
	try {
		const res = await fetch(`${SPELLS_URL}?t=${Date.now()}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Spells request failed (${res.status})`);
		const data = (await res.json()) as unknown;
		const list = Array.isArray(data) ? (data as SpellDefinition[]) : [];
		const merged = merge(list);
		spells.set(merged);
		loaded = true;
		return merged;
	} catch {
		const fallback = DEFAULT_SPELLS.map((s) => ({ ...s }));
		spells.set(fallback);
		return fallback;
	}
}

/** Return the loaded spells, fetching them once if not yet loaded. */
export async function ensureSpells(): Promise<SpellDefinition[]> {
	if (loaded) return get(spells);
	return refreshSpells();
}

// Persist the full set of spells through the admin endpoint and refresh the
// mirror from what was stored.
export async function saveSpells(list: SpellDefinition[]): Promise<void> {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ spells: list })
	});
	if (!res.ok) throw new Error(`Failed to save spells (${res.status})`);
	await refreshSpells();
}
