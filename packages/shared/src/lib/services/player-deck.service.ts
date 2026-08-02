import { get, writable, type Writable } from 'svelte/store';
import { authService } from '$services/auth.service';
import { getSupabaseClient } from '$utils/supabase/client';
import { playerDeckAdapter } from '$adapters/player-deck.adapter';
import type {
	PlayerDeck,
	PlayerDeckCard,
	PlayerDeckCardRow,
	PlayerDeckRow,
	PlayerDeckState
} from '$types/player-deck.type';

const EMPTY: PlayerDeckState = { decks: [], loading: false, saving: false, error: null };

/**
 * Owns the signed-in player's saved decks, backed by Supabase (the
 * `player_decks` and `player_deck_cards` tables). Mirrors `playerService`: it
 * follows the auth session, loading decks on sign-in and clearing them on
 * sign-out, so a player's decks are tied to their Discord account rather than
 * one browser.
 *
 * Decks persist as they are edited rather than through a save step: `create`
 * makes an empty deck the moment the player asks for one, and `update` records
 * every rename and card change. Both go through the `save_player_deck` RPC,
 * which replaces a deck's name and contents atomically and enforces the deck
 * rules (at most 30 cards, at most 3 copies of a card, only cards the player
 * owns) server-side.
 *
 * `update` is optimistic and coalescing: the store changes immediately so the
 * UI never waits on the network, and edits made while a write is in flight
 * collapse into one follow-up write rather than queueing a request per click. A
 * write that fails puts its message on the store and resyncs from the server,
 * so what is on screen is always what was actually stored.
 *
 * Components read `playerDeckService.store` reactively and call `create` /
 * `update` / `remove`; they never touch the Supabase client directly.
 */
class PlayerDeckService {
	store: Writable<PlayerDeckState>;

	// The user id the store currently reflects, used to ignore results from a load
	// that was superseded by a sign-out or account switch mid-flight.
	private currentUserId: string | null = null;

	// The latest unwritten state per deck, and which decks have a write running.
	// A deck's pending entry is overwritten rather than appended to, so a burst of
	// clicks costs one extra round trip instead of one per click.
	private pending = new Map<string, { name: string; cards: PlayerDeckCard[] }>();
	private writing = new Set<string>();

	constructor() {
		this.store = writable<PlayerDeckState>({ ...EMPTY });

		authService.store.subscribe((auth) => {
			const userId = auth.user?.id ?? null;
			if (userId === this.currentUserId) return;
			this.currentUserId = userId;
			if (userId) this.load(userId);
			else this.store.set({ ...EMPTY });
		});
	}

	// Load every deck and its contents for a user in one shot. RLS scopes both
	// reads to the caller, so the deck-cards query needs no join.
	private async load(userId: string): Promise<void> {
		const client = getSupabaseClient();
		if (!client) return;

		this.store.set({ ...EMPTY, loading: true });

		const [deckRes, cardRes] = await Promise.all([
			client
				.from('player_decks')
				.select('id,name')
				.eq('player_id', userId)
				.order('created_at', { ascending: true }),
			client.from('player_deck_cards').select('deck_id,card_id,quantity').eq('player_id', userId)
		]);

		// A newer auth change won the race; drop this stale result.
		if (this.currentUserId !== userId) return;

		if (deckRes.error) throw deckRes.error;
		if (cardRes.error) throw cardRes.error;

		this.store.set({
			...EMPTY,
			decks: playerDeckAdapter.fromRows(
				(deckRes.data ?? []) as PlayerDeckRow[],
				(cardRes.data ?? []) as PlayerDeckCardRow[]
			)
		});
	}

	// Re-read the decks from the server so the store reflects what was persisted
	// (including the ids the database assigned to new decks).
	private async refresh(userId: string): Promise<PlayerDeck[]> {
		const client = getSupabaseClient();
		if (!client) return [];

		const [deckRes, cardRes] = await Promise.all([
			client
				.from('player_decks')
				.select('id,name')
				.eq('player_id', userId)
				.order('created_at', { ascending: true }),
			client.from('player_deck_cards').select('deck_id,card_id,quantity').eq('player_id', userId)
		]);

		if (deckRes.error) throw deckRes.error;
		if (cardRes.error) throw cardRes.error;

		return playerDeckAdapter.fromRows(
			(deckRes.data ?? []) as PlayerDeckRow[],
			(cardRes.data ?? []) as PlayerDeckCardRow[]
		);
	}

	/**
	 * Create a deck and return its id. The deck starts empty and unnamed — it
	 * exists from the moment the player asks for one, and fills up through
	 * `update` — so this is awaited only to learn the id to edit. Returns `null`
	 * if the deck couldn't be created, with the reason on the store.
	 */
	async create(name: string = ''): Promise<string | null> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return null;

		this.store.update((s) => ({ ...s, saving: true, error: null }));

		const { data, error } = await client.rpc('save_player_deck', {
			p_deck_id: null,
			p_name: name,
			p_entries: []
		});

		if (error) {
			this.store.update((s) => ({ ...s, saving: false, error: error.message }));
			return null;
		}

		const id = data as string;
		if (this.currentUserId !== userId) return id;

		// Appended rather than re-read: decks are ordered by creation, so a new one
		// belongs at the end, and this keeps creating a deck to a single round trip.
		this.store.update((s) => ({
			...s,
			decks: [...s.decks, { id, name: name.trim(), cards: [] }],
			saving: this.writing.size > 0
		}));

		return id;
	}

	/**
	 * Record an edit to a deck: its new name, its new contents, or both. The store
	 * updates at once and the change is written in the background, so callers
	 * neither await this nor handle its failure — a failed write reports itself
	 * through `error` on the store.
	 */
	update(deckId: string, changes: Partial<Pick<PlayerDeck, 'name' | 'cards'>>): void {
		const current = get(this.store).decks.find((deck) => deck.id === deckId);
		// The deck isn't in the store — deleted, or never loaded. Nothing to write.
		if (!current) return;

		const edited: PlayerDeck = { ...current, ...changes };

		this.store.update((s) => ({
			...s,
			error: null,
			decks: s.decks.map((deck) => (deck.id === deckId ? edited : deck))
		}));

		this.pending.set(deckId, { name: edited.name, cards: edited.cards });
		void this.write(deckId);
	}

	/**
	 * Drain a deck's pending edits, one write at a time. Anything queued while a
	 * write is in flight is picked up by the same loop, so a deck never has two
	 * writes racing to be the last one the database sees.
	 */
	private async write(deckId: string): Promise<void> {
		if (this.writing.has(deckId)) return;

		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return;

		this.writing.add(deckId);
		this.store.update((s) => ({ ...s, saving: true }));

		try {
			while (this.pending.has(deckId) && this.currentUserId === userId) {
				const draft = this.pending.get(deckId)!;
				this.pending.delete(deckId);

				const { error } = await client.rpc('save_player_deck', {
					p_deck_id: deckId,
					p_name: draft.name,
					p_entries: playerDeckAdapter.toEntries(draft.cards)
				});

				if (!error) continue;

				// The optimistic store no longer matches the database, and later edits
				// were built on top of it, so they're dropped and the truth is re-read
				// rather than written over what was rejected.
				this.pending.delete(deckId);
				const decks = await this.refresh(userId);
				if (this.currentUserId === userId) {
					this.store.update((s) => ({ ...s, decks, error: error.message }));
				}
			}
		} finally {
			this.writing.delete(deckId);
			this.store.update((s) => ({ ...s, saving: this.writing.size > 0 }));
		}
	}

	/**
	 * Delete a deck. Its contents go with it via the deck-cards foreign key's
	 * cascade; the player's card ownership is untouched.
	 */
	async remove(deckId: string): Promise<void> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return;

		// Anything still unwritten for this deck dies with it.
		this.pending.delete(deckId);
		this.store.update((s) => ({ ...s, saving: true, error: null }));

		const { error } = await client.from('player_decks').delete().eq('id', deckId);
		if (error) {
			this.store.update((s) => ({ ...s, saving: this.writing.size > 0 }));
			throw error;
		}

		if (this.currentUserId !== userId) return;
		this.store.update((s) => ({
			...s,
			decks: s.decks.filter((deck) => deck.id !== deckId),
			saving: this.writing.size > 0
		}));
	}

	/** The current deck state snapshot. */
	get(): PlayerDeckState {
		return get(this.store);
	}
}

export const playerDeckService = new PlayerDeckService();
