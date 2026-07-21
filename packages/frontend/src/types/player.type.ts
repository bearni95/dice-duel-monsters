/**
 * A player's profile, keyed to their Supabase auth user id. Persisted in the
 * `profiles` table (see the supabase package migrations) — no longer local to a
 * single browser, so name/avatar/dice follow the signed-in Discord account.
 */
export interface PlayerProfile {
	/** Supabase auth user id (uuid). Matches `AuthUser.id`. */
	id: string;
	/** Player-chosen display name. Empty until the player sets it. */
	name: string;
	/** Chosen avatar, referenced by character slug. `null` until picked. */
	avatar: string | null;
}

/**
 * The reactive player state exposed by `playerService`. Loaded from Supabase on
 * sign-in and cleared on sign-out; `profile` is `null` while signed out or until
 * the first load resolves.
 */
export interface PlayerState {
	/** The signed-in player's profile, or `null` when signed out / not yet loaded. */
	profile: PlayerProfile | null;
	/**
	 * The dice the player owns, each referenced by its spawned-die id (e.g.
	 * `move-r3`). Stored in the `player_dice` table as a quantity per id and
	 * expanded here into a flat list (one entry per copy) so the dice adapter and
	 * UI keep working on a plain `string[]`.
	 */
	dice: string[];
	/** `true` while the profile + dice are being loaded from Supabase. */
	loading: boolean;
	/** `true` while a profile save or dice grant is in flight. */
	saving: boolean;
}

/** A row of the `profiles` table, as returned by the Supabase client. */
export interface ProfileRow {
	id: string;
	name: string;
	avatar: string | null;
}

/** A row of the `player_dice` table, as returned by the Supabase client. */
export interface PlayerDieRow {
	die_id: string;
	quantity: number;
}
