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

const EMPTY: PlayerDeckState = { decks: [], loading: false, saving: false };

/**
 * Owns the signed-in player's saved decks, backed by Supabase (the
 * `player_decks` and `player_deck_cards` tables). Mirrors `playerService`: it
 * follows the auth session, loading decks on sign-in and clearing them on
 * sign-out, so a player's decks are tied to their Discord account rather than
 * one browser.
 *
 * Saving goes through the `save_player_deck` RPC, which replaces a deck's name
 * and contents atomically and enforces the deck rules (exactly 30 cards, at most
 * 3 copies of a card, only cards the player owns) server-side.
 *
 * Components read `playerDeckService.store` reactively and call `save` /
 * `remove`; they never touch the Supabase client directly.
 */
class PlayerDeckService {
	store: Writable<PlayerDeckState>;

	// The user id the store currently reflects, used to ignore results from a load
	// that was superseded by a sign-out or account switch mid-flight.
	private currentUserId: string | null = null;

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
			decks: playerDeckAdapter.fromRows(
				(deckRes.data ?? []) as PlayerDeckRow[],
				(cardRes.data ?? []) as PlayerDeckCardRow[]
			),
			loading: false,
			saving: false
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
	 * Create or replace a deck. Pass `deckId: null` to create a new one; pass an
	 * existing id to overwrite that deck's name and contents. Returns the saved
	 * deck's id. Throws with the database's message when the deck breaks a rule,
	 * so the caller can surface it.
	 */
	async save(deckId: string | null, name: string, cards: PlayerDeckCard[]): Promise<string | null> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return null;

		this.store.update((s) => ({ ...s, saving: true }));

		const { data, error } = await client.rpc('save_player_deck', {
			p_deck_id: deckId,
			p_name: name,
			p_entries: playerDeckAdapter.toEntries(cards)
		});

		if (error) {
			this.store.update((s) => ({ ...s, saving: false }));
			throw error;
		}

		const decks = await this.refresh(userId);
		if (this.currentUserId !== userId) return (data as string) ?? null;
		this.store.update((s) => ({ ...s, decks, saving: false }));

		return (data as string) ?? null;
	}

	/**
	 * Delete a deck. Its contents go with it via the deck-cards foreign key's
	 * cascade; the player's card ownership is untouched.
	 */
	async remove(deckId: string): Promise<void> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return;

		this.store.update((s) => ({ ...s, saving: true }));

		const { error } = await client.from('player_decks').delete().eq('id', deckId);
		if (error) {
			this.store.update((s) => ({ ...s, saving: false }));
			throw error;
		}

		if (this.currentUserId !== userId) return;
		this.store.update((s) => ({
			...s,
			decks: s.decks.filter((deck) => deck.id !== deckId),
			saving: false
		}));
	}

	/** The current deck state snapshot. */
	get(): PlayerDeckState {
		return get(this.store);
	}
}

export const playerDeckService = new PlayerDeckService();
