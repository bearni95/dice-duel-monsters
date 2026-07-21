import { get, writable, type Writable } from 'svelte/store';
import { authAdapter } from '$adapters/auth.adapter';
import { getSupabaseClient, isSupabaseConfigured } from '$utils/supabase/client';
import type { AuthState } from '$types/auth.type';

/**
 * Wraps Supabase auth for the SPA. Auth runs entirely in the browser — the local
 * dev backend is never involved — so this service owns the reactive session
 * state, listens for Supabase auth changes, and exposes Discord sign-in/out.
 *
 * Components read `authService.store` reactively and call `signInWithDiscord()` /
 * `signOut()`; they never touch the Supabase client directly.
 */
class AuthService {
	store: Writable<AuthState>;

	/** Mirrors `isSupabaseConfigured` so the UI can hide auth when unconfigured. */
	readonly configured = isSupabaseConfigured;

	constructor() {
		this.store = writable<AuthState>({ user: null, loading: this.configured });
		this.init();
	}

	// Resolves the current session (if the browser already has one, or one was
	// just returned via the OAuth redirect) and subscribes to future changes.
	private init(): void {
		const client = getSupabaseClient();
		if (!client) {
			this.store.set({ user: null, loading: false });
			return;
		}

		client.auth.getSession().then(({ data }) => {
			const user = data.session?.user ?? null;
			this.store.set({
				user: user ? authAdapter.fromSupabase(user) : null,
				loading: false
			});
		});

		client.auth.onAuthStateChange((_event, session) => {
			const user = session?.user ?? null;
			this.store.set({
				user: user ? authAdapter.fromSupabase(user) : null,
				loading: false
			});
		});
	}

	/** The current user id, or `null` when signed out. */
	get userId(): string | null {
		return get(this.store).user?.id ?? null;
	}

	/**
	 * Kicks off the Discord OAuth flow. Redirects the browser to Discord and back
	 * to the current origin, where Supabase reads the session out of the URL.
	 */
	async signInWithDiscord(): Promise<void> {
		const client = getSupabaseClient();
		if (!client) return;
		await client.auth.signInWithOAuth({
			provider: 'discord',
			options: {
				redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
			}
		});
	}

	/** Clears the local session and signs the user out. */
	async signOut(): Promise<void> {
		const client = getSupabaseClient();
		if (!client) return;
		await client.auth.signOut();
	}
}

export const authService = new AuthService();
