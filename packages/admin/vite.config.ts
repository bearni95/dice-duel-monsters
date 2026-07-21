import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { serveDataAssets } from './vite/serve-data-assets';

// The admin app authors the game data (decks, dice, card effects, positions) and
// serves it read-through from the `data` package so its own edits are live
// without a copy step — see vite/serve-data-assets.ts.
export default defineConfig({
	plugins: [serveDataAssets(), tailwindcss(), sveltekit()],
	server: {
		// A distinct port so admin can run alongside the frontend dev server.
		port: 5174
	}
});
