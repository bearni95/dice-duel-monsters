import { createRequire } from 'module';
import { dirname, join, extname } from 'path';
import { existsSync, statSync, createReadStream } from 'fs';
import type { Plugin } from 'vite';

// Serves the runtime game assets the admin pages fetch — the same URLs the
// shipped frontend serves from its static tree — straight from the `data`
// package (and, for generated card PNGs, the frontend's static tree). Because it
// reads through on every request, an edit made via an admin write-endpoint is
// immediately visible to the admin UI with no copy/sync step.
const require = createRequire(import.meta.url);
const DATA_ROOT = dirname(require.resolve('data/package.json'));
const FRONTEND_GENERATED = join(DATA_ROOT, '..', 'frontend', 'static', 'cards', 'generated');

// Ordered URL matchers → absolute file path. First match wins.
const routes: Array<{ re: RegExp; to: (m: RegExpMatchArray) => string }> = [
	{ re: /^\/cards\/catalog\.json$/, to: () => join(DATA_ROOT, 'dist', 'catalog.json') },
	{ re: /^\/cards\/generated\/([^/]+)$/, to: (m) => join(FRONTEND_GENERATED, m[1]) },
	{ re: /^\/card-effects\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'card-effects', m[1]) },
	{ re: /^\/decks\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'decks', m[1]) },
	{ re: /^\/dice\/([^/]+)$/, to: (m) => join(DATA_ROOT, 'dice', m[1]) }
];

const CONTENT_TYPES: Record<string, string> = {
	'.json': 'application/json; charset=utf-8',
	'.png': 'image/png'
};

export function serveDataAssets(): Plugin {
	return {
		name: 'serve-data-assets',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
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
