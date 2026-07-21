import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		// The admin app has a real backend (the moved +server.ts endpoints), so it
		// runs as a Node server rather than a static SPA. It is dev-only tooling and
		// is never deployed alongside the shipped frontend.
		adapter: adapter(),

		// Shared UI/logic lives in the `shared` package; these aliases resolve into
		// its source (compiled by this app's Vite), matching the frontend so the
		// moved admin routes' `$…` imports keep working unchanged.
		alias: {
			$components: '../shared/src/lib/components/*',
			$utils: '../shared/src/lib/utils/*',
			$types: '../shared/src/lib/types/*',
			$data: '../shared/src/lib/data/*',
			$adapters: '../shared/src/lib/adapters/*',
			$services: '../shared/src/lib/services/*'
		}
	}
};

export default config;
