/**
 * A player's profile, keyed to their Supabase auth user id. Persisted in the
 * `profiles` table (see the supabase package migrations) — no longer local to a
 * single browser, so name/avatar follow the signed-in Discord account.
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
	 * The cards the player owns, each referenced by its numeric card id (the
	 * Yu-Gi-Oh! passcode). Stored in the `player_cards` table as a quantity per id
	 * and expanded here into a flat list (one entry per copy) so the collection UI
	 * can tally copies.
	 */
	cards: number[];
	/** `true` while the profile + cards are being loaded from Supabase. */
	loading: boolean;
	/** `true` while a profile save or card grant is in flight. */
	saving: boolean;
}

/** A row of the `profiles` table, as returned by the Supabase client. */
export interface ProfileRow {
	id: string;
	name: string;
	avatar: string | null;
}

/** A row of the `player_cards` table, as returned by the Supabase client. */
export interface PlayerCardRow {
	card_id: number;
	quantity: number;
}
