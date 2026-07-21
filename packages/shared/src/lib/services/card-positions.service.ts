import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import type { ID } from '$types/core.type';
import { invalidateCatalog } from '$adapters/cardApi.adapter';

// Per-card board positioning — a billboard size factor plus an x/y pixel offset
// of the image (its red square) relative to its cell (the purple square) —
// persisted under data/cards/positions.json through the /cards/positions
// endpoint and baked into the card catalog at build time. Edited from the
// board-preview modal on /cards. Because the source file lives outside
// static/ (it's a build input, never shipped), both reads and writes go through
// the endpoint rather than fetching a served asset. Keyed by stringified card
// id; only fields adjusted away from their default are stored, and a card left
// fully at the default (size 1, x/y 0 — the borders matching, centered) has no
// entry.
const ENDPOINT = '/cards/positions';

export type CardPosition = { size: number; x: number; y: number };

// The default position: borders matching, image centered on the cell.
export const DEFAULT_CARD_POSITION: CardPosition = { size: 1, x: 0, y: 0 };

// The stored (partial) shape: only non-default fields are present on disk.
type StoredPosition = { size?: number; x?: number; y?: number };
type PositionsMap = Record<string, StoredPosition>;

// Reactive mirror of every adjusted card's position (`cardId -> { size?, x?, y? }`).
export const cardPositions = writable<PositionsMap>({});

let loaded = false;

/** Reload every card's stored position from the endpoint. */
export async function refreshCardPositions(): Promise<PositionsMap> {
	if (!browser) return {};
	try {
		const res = await fetch(`${ENDPOINT}?t=${Date.now()}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Card positions request failed (${res.status})`);
		const data = (await res.json()) as unknown;
		const map =
			data && typeof data === 'object' && !Array.isArray(data) ? (data as PositionsMap) : {};
		cardPositions.set(map);
		loaded = true;
		return map;
	} catch {
		cardPositions.set({});
		return {};
	}
}

/** Return the loaded map, fetching it once if not yet loaded. */
export async function ensureCardPositions(): Promise<PositionsMap> {
	if (loaded) return get(cardPositions);
	return refreshCardPositions();
}

// The full position for a card, with any unstored field filled from the default.
// Callers should have loaded the map via ensureCardPositions()/refreshCardPositions().
export function getCardPosition(cardId: ID): CardPosition {
	const stored = get(cardPositions)[String(cardId)] ?? {};
	return {
		size: Number.isFinite(stored.size) ? (stored.size as number) : DEFAULT_CARD_POSITION.size,
		x: Number.isFinite(stored.x) ? (stored.x as number) : DEFAULT_CARD_POSITION.x,
		y: Number.isFinite(stored.y) ? (stored.y as number) : DEFAULT_CARD_POSITION.y
	};
}

// Persist a card's position through the endpoint and refresh the mirror. Fields
// left at their default are dropped server-side; a fully-default position clears
// the card's entry entirely.
export async function setCardPosition(cardId: ID, position: CardPosition): Promise<void> {
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ cardId: String(cardId), ...position })
	});
	if (!res.ok) throw new Error(`Failed to save card position (${res.status})`);
	// The endpoint rebuilds static/cards/catalog.json (what the board renders from)
	// as part of the save, so drop the tab's memoised catalog — otherwise a
	// client-side navigation to the board would keep using the pre-save snapshot
	// and the new positioning wouldn't apply until a hard reload.
	invalidateCatalog();
	await refreshCardPositions();
}
