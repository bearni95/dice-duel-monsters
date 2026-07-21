import { get, writable, type Writable } from 'svelte/store';
import { authService } from '$services/auth.service';
import { getSupabaseClient } from '$utils/supabase/client';
import { playerAdapter } from '$adapters/player.adapter';
import type { PlayerState, ProfileRow, PlayerDieRow } from '$types/player.type';

const EMPTY: PlayerState = { profile: null, dice: [], loading: false, saving: false };

/**
 * Owns the signed-in player's profile and dice, backed by Supabase (the
 * `profiles` and `player_dice` tables) rather than localStorage. It follows the
 * auth session: loading the player's data when they sign in and clearing it when
 * they sign out, so ownership is tied to the Discord account and shared across
 * devices.
 *
 * Components read `playerService.store` reactively and call `saveProfile` /
 * `grantDice`; they never touch the Supabase client directly.
 */
class PlayerService {
	store: Writable<PlayerState>;

	// The user id the store currently reflects, used to ignore results from a load
	// that was superseded by a sign-out or account switch mid-flight.
	private currentUserId: string | null = null;

	constructor() {
		this.store = writable<PlayerState>({ ...EMPTY });

		// Drive everything off the auth session: (re)load on sign-in, wipe on
		// sign-out. Runs immediately with the current session too.
		authService.store.subscribe((auth) => {
			const userId = auth.user?.id ?? null;
			if (userId === this.currentUserId) return;
			this.currentUserId = userId;
			if (userId) this.load(userId);
			else this.store.set({ ...EMPTY });
		});
	}

	// Load the profile and owned dice for a user from Supabase in one shot.
	private async load(userId: string): Promise<void> {
		const client = getSupabaseClient();
		if (!client) return;

		this.store.set({ ...EMPTY, loading: true });

		const [profileRes, diceRes] = await Promise.all([
			client.from('profiles').select('id,name,avatar').eq('id', userId).maybeSingle(),
			client.from('player_dice').select('die_id,quantity').eq('player_id', userId).gt('quantity', 0)
		]);

		// A newer auth change won the race; drop this stale result.
		if (this.currentUserId !== userId) return;

		if (profileRes.error) throw profileRes.error;
		if (diceRes.error) throw diceRes.error;

		const profileRow = profileRes.data as ProfileRow | null;
		this.store.set({
			profile: profileRow
				? playerAdapter.fromProfileRow(profileRow)
				: { id: userId, name: '', avatar: null },
			dice: playerAdapter.diceFromRows((diceRes.data ?? []) as PlayerDieRow[]),
			loading: false,
			saving: false
		});
	}

	/**
	 * Persist the player's name and avatar, upserting their profile row. Requires
	 * a signed-in user; no-ops otherwise.
	 */
	async saveProfile(name: string, avatar: string | null): Promise<void> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client) return;

		this.store.update((s) => ({ ...s, saving: true }));

		const { error } = await client
			.from('profiles')
			.upsert(playerAdapter.toProfileRow({ id: userId, name, avatar }));

		if (error) {
			this.store.update((s) => ({ ...s, saving: false }));
			throw error;
		}

		this.store.update((s) => ({ ...s, profile: { id: userId, name, avatar }, saving: false }));
	}

	/**
	 * Grant the given spawned-die ids to the player (duplicates allowed), then
	 * refresh the owned dice from the server so the store reflects the new totals.
	 */
	async grantDice(dieIds: string[]): Promise<void> {
		const userId = this.currentUserId;
		const client = getSupabaseClient();
		if (!userId || !client || dieIds.length === 0) return;

		this.store.update((s) => ({ ...s, saving: true }));

		const { error } = await client.rpc('grant_dice', { die_ids: dieIds });
		if (error) {
			this.store.update((s) => ({ ...s, saving: false }));
			throw error;
		}

		const { data, error: readError } = await client
			.from('player_dice')
			.select('die_id,quantity')
			.eq('player_id', userId)
			.gt('quantity', 0);

		if (readError) {
			this.store.update((s) => ({ ...s, saving: false }));
			throw readError;
		}

		if (this.currentUserId !== userId) return;
		this.store.update((s) => ({
			...s,
			dice: playerAdapter.diceFromRows((data ?? []) as PlayerDieRow[]),
			saving: false
		}));
	}

	/** The current player state snapshot. */
	get(): PlayerState {
		return get(this.store);
	}
}

export const playerService = new PlayerService();
