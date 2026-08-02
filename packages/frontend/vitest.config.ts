import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [svelte({ hot: !process.env.VITEST })],
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: ['./test/setup.ts'],
		include: ['test/**/*.{test,spec}.{js,ts}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'test/', '**/*.d.ts', '**/*.config.*', '**/mockData', 'dist/']
		}
	},
	resolve: {
		// Svelte ships a server build and a client build behind export conditions.
		// Without this, importing a component here resolves to the server one, whose
		// `mount()` throws — component tests can only run against the client build.
		conditions: ['browser'],
		alias: {
			$lib: resolve(__dirname, '../shared/src/lib'),
			$services: resolve(__dirname, '../shared/src/lib/services'),
			$adapters: resolve(__dirname, '../shared/src/lib/adapters'),
			$types: resolve(__dirname, '../shared/src/lib/types'),
			$utils: resolve(__dirname, '../shared/src/lib/utils'),
			$components: resolve(__dirname, '../shared/src/lib/components'),
			$data: resolve(__dirname, '../shared/src/lib/data'),
			$app: resolve(__dirname, './test/mocks/$app')
		}
	}
});
