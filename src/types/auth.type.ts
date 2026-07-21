/**
 * The authenticated user, reduced to the fields the UI actually needs. The
 * `authAdapter` maps a Supabase `User` into this shape so components never touch
 * the raw provider payload.
 */
export interface AuthUser {
	/** Supabase user id (uuid). */
	id: string;
	/** Best-effort display name pulled from the Discord profile. */
	name: string;
	/** Account email, when the provider shares it. `null` otherwise. */
	email: string | null;
	/** Avatar image URL from the Discord profile, or `null`. */
	avatar: string | null;
}

/** The current authentication state, exposed as a reactive store. */
export interface AuthState {
	/** The signed-in user, or `null` when signed out. */
	user: AuthUser | null;
	/** `true` until the initial session lookup resolves, to avoid UI flicker. */
	loading: boolean;
}
