import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: 'index.html', // This is crucial for SPA mode
			precompress: false,
			strict: false // This tells the adapter to ignore dynamic routes
		}),
			// Shared UI/logic lives in the `shared` package; these aliases resolve
			// into its source (compiled by this app's Vite). See packages/shared.
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
