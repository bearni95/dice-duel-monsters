import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv, normalizePath, type Plugin } from 'vite';

// The `/admin` routes (card/effect/deck editors) and the server endpoints they
// write through are development-only tooling: the shipped product is a static
// SPA where none of it makes sense. They are exposed only while running
// `pnpm dev` with `ADMIN_ENABLED=true` in `.env`; every production build (and
// any dev run without the flag) stubs them out so no admin code is bundled.
const ADMIN_DIR = '/src/routes/admin/';

// Replaces a disabled admin page with a component that bounces home, so the real
// editor UI is never emitted into the production bundle.
const PAGE_STUB = `<script>
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	onMount(() => goto('/'));
</script>`;

// Replaces a disabled admin endpoint so every method 404s and the real handler
// (filesystem writes, upstream proxies) never ships.
const SERVER_STUB = `import { error } from '@sveltejs/kit';
const gone = () => {
	throw error(404, 'Not found');
};
export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
`;

function adminGuard(enabled: boolean): Plugin {
	return {
		name: 'admin-guard',
		enforce: 'pre',
		load(id) {
			if (enabled) return null;
			const path = normalizePath(id).split('?')[0];
			if (!path.includes(ADMIN_DIR)) return null;
			if (path.endsWith('/+page.svelte')) return PAGE_STUB;
			if (path.endsWith('+server.ts')) return SERVER_STUB;
			return null;
		}
	};
}

export default defineConfig(({ command, mode }) => {
	// Load every var (empty prefix), not just VITE_-prefixed ones, so the
	// server-only flag is readable at config time.
	const env = loadEnv(mode, process.cwd(), '');
	const adminEnabled = command === 'serve' && env.ADMIN_ENABLED === 'true';

	return {
		plugins: [adminGuard(adminEnabled), tailwindcss(), sveltekit()],
		server: {
			// The /admin card tooling bakes PNGs into static/cards/generated at runtime
			// (see /admin/print/save). That folder is Vite's publicDir, so without this
			// each write would trigger a full page reload — interrupting the very render
			// queue producing the files. Ignore it so baking doesn't churn the page.
			watch: { ignored: ['**/static/cards/generated/**'] }
		},
		// Surfaced to client code (e.g. the navbar) so admin links can be hidden
		// when the tooling is not built in.
		define: {
			'import.meta.env.VITE_ADMIN_ENABLED': JSON.stringify(adminEnabled)
		}
	};
});
