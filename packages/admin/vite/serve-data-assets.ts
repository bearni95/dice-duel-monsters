import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { existsSync, statSync, createReadStream } from 'fs';
import type { Plugin } from 'vite';

// Serves the runtime game assets the admin pages fetch — the same URLs the
// shipped frontend serves from its static tree — straight from the packages that
// own them: game data (decks, dice, card effects, catalog) from the `data`
// package, generated card PNGs from the `assets` package where the admin bake
// endpoints write them, and the static media (card textures, attribute/type/icon
// art, character portraits) from the frontend's static tree, its canonical home.
// Serving that media here from disk — rather than proxying it to the frontend dev
// server — is what lets the admin app (and its card bake) run without the frontend
// running at all. Because it reads through on every request, an edit made via an
// admin write-endpoint is immediately visible to the admin UI with no copy step.
const require = createRequire(import.meta.url);
const DATA_ROOT = dirname(require.resolve('data/package.json'));
const ASSETS_ROOT = dirname(require.resolve('assets/package.json'));
const ASSETS_GENERATED = join(ASSETS_ROOT, 'cards', 'generated');
const ASSETS_DICE_GENERATED = join(ASSETS_ROOT, 'dice', 'generated');

// The frontend's static tree, resolved by repo layout (packages/frontend/static)
// rather than a package dependency, so admin needs nothing from the frontend at
// runtime — only that these committed files sit where they always have.
const FRONTEND_STATIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'static');

// Ordered URL matchers → absolute file path. First match wins.
const routes: Array<{ re: RegExp; to: (m: RegExpMatchArray) => string }> = [
	{ re: /^\/cards\/catalog\.json$/, to: () => join(DATA_ROOT, 'dist', 'catalog.json') },
	// The allow-list of grantable card ids, emitted next to the catalog by
	// build-grantable-cards. Served under the same name the frontend uses.
	{ re: /^\/cards\/grantable\.json$/, to: () => join(DATA_ROOT, 'dist', 'grantable-cards.json') },
	{ re: /^\/cards\/generated\/([^/]+)$/, to: (m) => join(ASSETS_GENERATED, m[1]) },
	// Monster cutout billboards (the on-board sprites the catalog references as
	// `/cards/monster-billboards/…`), served from the frontend's static tree so the
	// board preview modal can load them without the frontend running.
	{
		re: /^\/cards\/monster-billboards\/([^/]+)$/,
		to: (m) => join(FRONTEND_STATIC, 'cards', 'monster-billboards', m[1])
	},
	{ re: /^\/card-effects\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'card-effects', m[1]) },
	{ re: /^\/decks\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'decks', m[1]) },
	// Baked die-face PNGs written by the /dice export endpoint, read through from
	// the assets package (their git-tracked home) — matched before the generic
	// dice-data route so the `generated/` subpath doesn't fall through to DATA_ROOT.
	{ re: /^\/dice\/generated\/([^/]+)$/, to: (m) => join(ASSETS_DICE_GENERATED, m[1]) },
	{ re: /^\/dice\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'dice', m[1]) },
	{ re: /^\/spells\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'spells', m[1]) },
	// Static media from the frontend's static tree. `/characters` is also an admin
	// page, so only portrait files under it (a name with an extension) are matched.
	{ re: /^\/(assets|textures)\/(.+)$/, to: (m) => join(FRONTEND_STATIC, m[1], m[2]) },
	{ re: /^\/(characters\/[^/]+\.[a-z0-9]+)$/i, to: (m) => join(FRONTEND_STATIC, m[1]) }
];

const CONTENT_TYPES: Record<string, string> = {
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.gif': 'image/gif'
};

export function serveDataAssets(): Plugin {
	return {
		name: 'serve-data-assets',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
				// The media routes match sub-paths, so refuse any `..` before it can
				// escape a served root; browsers normalize these away, but a crafted or
				// encoded request must not reach the filesystem join.
				let decoded = url;
				try {
					decoded = decodeURIComponent(url);
				} catch {
					// Malformed percent-encoding — treat as unservable and move on.
					next();
					return;
				}
				if (decoded.split('/').includes('..')) {
					next();
					return;
				}
				for (const { re, to } of routes) {
					const m = url.match(re);
					if (!m) continue;
					const file = to(m);
					if (!existsSync(file) || !statSync(file).isFile()) {
						// Only claim URLs we can actually serve. On a miss, fall through to
						// SvelteKit rather than 404ing — the admin CRUD endpoints share these
						// prefixes (e.g. /dice/store, /decks/search) and must reach their routes.
						break;
					}
					res.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
					// Author-then-read loop: never cache, so admin edits show on reload.
					res.setHeader('Cache-Control', 'no-store');
					createReadStream(file).pipe(res);
					return;
				}
				next();
			});
		}
	};
}
