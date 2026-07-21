import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { CardEffectImplementation } from '$types/card-effect.type';
import type { ID } from '$types/core.type';

// Per-card effect implementations, persisted as a single static JSON file under
// `static/card-effects/` (see the /cards/effects endpoint) and edited from
// the effects modal on /cards. Replaces the old localStorage collection so
// assignments are shared server-side, exactly like character→deck assignments.
// Keyed by card id (stringified, since JSON object keys are strings); a card with
// no implementations has no entry at all.
const ASSIGNMENTS_URL = '/card-effects/assignments.json';
const ENDPOINT = '/cards/effects';

type EffectsMap = Record<string, CardEffectImplementation[]>;

// Reactive mirror of every card's implementations (`cardId -> implementations[]`).
export const cardEffects = writable<EffectsMap>({});

let loaded = false;

/** Reload every card's implementations from the static assignments file. */
export async function refreshCardEffects(): Promise<EffectsMap> {
	if (!browser) return {};
	try {
		const res = await fetch(`${ASSIGNMENTS_URL}?t=${Date.now()}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Card effects request failed (${res.status})`);
		const data = (await res.json()) as unknown;
		const map =
			data && typeof data === 'object' && !Array.isArray(data) ? (data as EffectsMap) : {};
		cardEffects.set(map);
		loaded = true;
		return map;
	} catch {
		cardEffects.set({});
		return {};
	}
}

/** Return the loaded map, fetching it once if not yet loaded. */
export async function ensureCardEffects(): Promise<EffectsMap> {
	if (loaded) return get(cardEffects);
	return refreshCardEffects();
}

// The effect templates a card currently implements (empty when it has none),
// read from the in-memory mirror. Callers should have loaded it via
// ensureCardEffects()/refreshCardEffects() first.
export function getCardImplementations(cardId: ID): CardEffectImplementation[] {
	return get(cardEffects)[String(cardId)] ?? [];
}

// Replace a card's implementations, persisting through the endpoint and
// refreshing the mirror. An empty list clears the card's entry entirely.
export async function setCardImplementations(
	cardId: ID,
	implementations: CardEffectImplementation[]
): Promise<void> {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cardId: String(cardId), implementations })
	});
	if (!res.ok) throw new Error(`Failed to save card effects (${res.status})`);
	await refreshCardEffects();
}
