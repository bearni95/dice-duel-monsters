import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The shipped product is a static SPA: authentication talks directly to Supabase
// from the browser, never through the local dev backend (which is admin tooling
// only). Both values are public by design — the anon key is safe to embed in the
// client bundle — and are inlined at build time from `.env` via Vite's
// `import.meta.env`. See `.env.example` for the required keys.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when both Supabase env values are present. Lets the UI degrade gracefully
 * (hide the sign-in button, show a hint) instead of throwing when auth is not
 * configured for a given build.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let client: SupabaseClient | null = null;

/**
 * Lazily creates the singleton Supabase client. Returns `null` when the env
 * values are missing so callers can no-op rather than crash. Supabase persists
 * its own session in localStorage and picks the OAuth result back up from the
 * redirect URL (`detectSessionInUrl`), so no server round-trip is needed.
 */
export function getSupabaseClient(): SupabaseClient | null {
	if (!isSupabaseConfigured) return null;
	if (!client) {
		client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true
			}
		});
	}
	return client;
}
