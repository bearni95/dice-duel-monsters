import type { User } from '@supabase/supabase-js';
import { AdapterClass } from './classes/adapter.class';
import type { AuthUser } from '$types/auth.type';

// Maps the raw Supabase/Discord user payload into the trimmed `AuthUser` the app
// works with, so components and services never reach into provider metadata.
export class AuthAdapter extends AdapterClass {
	constructor() {
		super('auth');
	}

	fromSupabase(user: User): AuthUser {
		const meta = user.user_metadata ?? {};
		// Discord surfaces the handle under a few keys depending on the provider
		// version; fall back through them, then to the email local-part.
		const name =
			(meta.full_name as string) ||
			(meta.name as string) ||
			(meta.user_name as string) ||
			(meta.preferred_username as string) ||
			user.email?.split('@')[0] ||
			'Guardian';

		return {
			id: user.id,
			name,
			email: user.email ?? null,
			avatar: (meta.avatar_url as string) || (meta.picture as string) || null
		};
	}
}

export const authAdapter = new AuthAdapter();
