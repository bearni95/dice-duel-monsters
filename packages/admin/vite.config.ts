import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { serveDataAssets } from './vite/serve-data-assets';

// The admin app authors the game data (decks, dice, card effects, positions) and
// serves it — along with the generated card PNGs and the frontend's static media
// (textures, attribute/type/icon art, character portraits) — read-through from
// disk via serveDataAssets. Serving that media locally is what lets the admin app
// and its card bake run with no dependency on the frontend dev server.
export default defineConfig({
	plugins: [serveDataAssets(), tailwindcss(), sveltekit()],
	server: {
		// The admin dev server must always run on 6040; fail rather than
		// silently pick another port when it is taken.
		port: 6040,
		strictPort: true
	}
});
