import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { ObjectServiceClass } from '$services/classes/object-service.class';
import type { Deck, DeckSelection } from '$types/deck.type';

// Decks are persisted as static JSON files under `static/decks/` (see the
// /admin/decks/store endpoint), replacing the old localStorage collection. The
// client reads the regenerated `manifest.json` aggregate to list every deck and
// writes through the endpoint, which works in dev where the files are authored.
const MANIFEST_URL = '/decks/manifest.json';
const ASSIGNMENTS_URL = '/decks/assignments.json';
const STORE_ENDPOINT = '/admin/decks/store';
const ASSIGNMENTS_ENDPOINT = '/admin/decks/assignments';

// Reactive mirror of every saved deck, populated from the manifest.
export const decks = writable<Deck[]>([]);

// Reactive mirror of the character→deck assignments (`slug -> deckId`).
export const characterDecks = writable<Record<string, string>>({});

let decksLoaded = false;

/** Reload every saved deck from the static manifest. */
export async function refreshDecks(): Promise<Deck[]> {
	if (!browser) return [];
	try {
		const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Manifest request failed (${res.status})`);
		const data = (await res.json()) as unknown;
		const list = Array.isArray(data) ? (data as Deck[]) : [];
		decks.set(list);
		decksLoaded = true;
		return list;
	} catch {
		decks.set([]);
		return [];
	}
}

/** Return the loaded decks, fetching the manifest once if not yet loaded. */
export async function ensureDecks(): Promise<Deck[]> {
	if (decksLoaded) return get(decks);
	return refreshDecks();
}

/**
 * Persist a deck as a static JSON file. Omit `id` to create a new deck (the
 * server derives a unique slug); pass an existing `id` to overwrite it. Returns
 * the saved deck with its final id.
 */
export async function saveDeck(input: {
	id?: string;
	name: string;
	main: number[];
	extra: number[];
	side: number[];
	disabled?: number[];
	forced?: number[];
}): Promise<Deck> {
	const res = await fetch(STORE_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	if (!res.ok) {
		const message = await res
			.json()
			.then((d) => d?.message as string | undefined)
			.catch(() => undefined);
		throw new Error(message ?? `Failed to save deck (${res.status})`);
	}
	const { deck } = (await res.json()) as { deck: Deck };
	await refreshDecks();
	return deck;
}

/** Delete a saved deck file (also clears any board/character reference to it). */
export async function deleteDeck(id: string): Promise<void> {
	const res = await fetch(`${STORE_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(`Failed to delete deck (${res.status})`);

	// The endpoint already purges character assignments; mirror that locally and
	// drop any board-side selection that pointed at the removed deck.
	const selection = deckSelectionService.get();
	if (selection.playerDeckId === id || selection.cpuDeckId === id) {
		deckSelectionService.set({
			...selection,
			playerDeckId: selection.playerDeckId === id ? null : selection.playerDeckId,
			cpuDeckId: selection.cpuDeckId === id ? null : selection.cpuDeckId
		});
	}
	await Promise.all([refreshDecks(), refreshAssignments()]);
}

/** Reload the character→deck assignment map from its static JSON file. */
export async function refreshAssignments(): Promise<Record<string, string>> {
	if (!browser) return {};
	try {
		const res = await fetch(`${ASSIGNMENTS_URL}?t=${Date.now()}`, { cache: 'no-store' });
		if (!res.ok) throw new Error(`Assignments request failed (${res.status})`);
		const data = (await res.json()) as unknown;
		const map = data && typeof data === 'object' && !Array.isArray(data)
			? (data as Record<string, string>)
			: {};
		characterDecks.set(map);
		return map;
	} catch {
		characterDecks.set({});
		return {};
	}
}

/** Assign a deck to a character, or pass `null` to clear the assignment. */
export async function assignCharacterDeck(
	characterSlug: string,
	deckId: string | null
): Promise<void> {
	const res = await fetch(ASSIGNMENTS_ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ characterSlug, deckId })
	});
	if (!res.ok) throw new Error(`Failed to save assignment (${res.status})`);
	await refreshAssignments();
}

/** The full deck assigned to a character, resolved from the static decks. */
export async function getCharacterDeck(characterSlug: string): Promise<Deck | null> {
	const map = get(characterDecks);
	const deckId = map[characterSlug] ?? (await refreshAssignments())[characterSlug];
	if (!deckId) return null;
	const list = await ensureDecks();
	return list.find((d) => d.id === deckId) ?? null;
}

/** The saved deck with the given id, or null when the id is empty/unknown. */
export async function getDeckById(id: string | null | undefined): Promise<Deck | null> {
	if (!id) return null;
	const list = await ensureDecks();
	return list.find((d) => d.id === id) ?? null;
}

// Which saved deck backs each side of the board — a transient pointer (deck ids)
// kept in localStorage; the deck data it references now lives in static JSON.
export const deckSelectionService = new ObjectServiceClass<DeckSelection>('deck-selection', {
	id: 'deck-selection',
	playerDeckId: null,
	cpuDeckId: null
});

// The deck currently assigned to the player, or null when none is selected.
export async function getPlayerDeck(): Promise<Deck | null> {
	const { playerDeckId } = deckSelectionService.get();
	if (!playerDeckId) return null;
	const list = await ensureDecks();
	return list.find((d) => d.id === playerDeckId) ?? null;
}

// The deck currently assigned to the CPU rival, or null when none is selected.
export async function getCpuDeck(): Promise<Deck | null> {
	const { cpuDeckId } = deckSelectionService.get();
	if (!cpuDeckId) return null;
	const list = await ensureDecks();
	return list.find((d) => d.id === cpuDeckId) ?? null;
}
