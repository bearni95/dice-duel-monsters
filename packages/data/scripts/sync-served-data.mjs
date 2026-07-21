#!/usr/bin/env node
// Copies the runtime-served subset of the game data (authored in this package,
// the single source of truth) into a consumer's static dir so a static host can
// serve it. The frontend runs this on dev + build; the admin app serves the same
// files read-through instead (see packages/admin/vite/serve-data-assets.ts).
//
// Usage: sync-served-data <destStaticDir>   (dest resolved against cwd)
// The card catalog is NOT synced here — build-card-catalog emits it straight to
// the consumer via CARD_CATALOG_OUT. Generated card PNGs are served by the
// frontend from its own static tree and are likewise out of scope.

import { mkdirSync, existsSync, statSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const destArg = process.argv[2];
if (!destArg) {
	console.error('[sync-served-data] missing destination static dir');
	process.exit(1);
}
const dest = resolve(process.cwd(), destArg);

// [sourceRelativeToPackage, destRelativeToStatic]. A directory (decks) copies
// recursively; a single file copies directly. Only the files the shipped SPA
// actually fetches are synced.
const items = [
	['card-effects/assignments.json', 'card-effects/assignments.json'],
	['dice/templates.json', 'dice/templates.json'],
	['decks', 'decks'] // manifest.json, assignments.json + individual deck files
];

let copied = 0;
for (const [src, out] of items) {
	const from = join(root, src);
	if (!existsSync(from)) continue;
	const to = join(dest, out);
	if (statSync(from).isDirectory()) {
		mkdirSync(to, { recursive: true });
		for (const f of readdirSync(from)) {
			if (statSync(join(from, f)).isFile()) {
				copyFileSync(join(from, f), join(to, f));
				copied++;
			}
		}
	} else {
		mkdirSync(dirname(to), { recursive: true });
		copyFileSync(from, to);
		copied++;
	}
}

console.log(`[sync-served-data] synced ${copied} served file(s) into ${dest}`);
