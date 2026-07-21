import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { serveDataAssets } from './vite/serve-data-assets';

// Static media (card textures, attribute/type/icon art, character portraits)
// is not part of the admin app — it lives in the frontend's static tree and
// must not be duplicated here. Point those requests at the frontend dev server.
const FRONTEND_ORIGIN = 'http://localhost:6030';

// The admin app authors the game data (decks, dice, card effects, positions) and
// serves it read-through from the `data` package so its own edits are live
// without a copy step — see vite/serve-data-assets.ts.
export default defineConfig({
	plugins: [serveDataAssets(), tailwindcss(), sveltekit()],
	server: {
		// The admin dev server must always run on 6040; fail rather than
		// silently pick another port when it is taken.
		port: 6040,
		strictPort: true,
		// Frontend-hosted static assets the shared UI references by root-relative
		// URL (/textures, /assets, /characters/*.png). These aren't served here, so
		// proxy them to the frontend rather than 404. `/characters` is also an admin
		// page, so only the portrait files under it (with an extension) are matched.
		proxy: {
			'^/(assets|textures)/': { target: FRONTEND_ORIGIN, changeOrigin: true },
			'^/characters/[^/]+\\.[a-z0-9]+$': { target: FRONTEND_ORIGIN, changeOrigin: true }
		}
	}
});
