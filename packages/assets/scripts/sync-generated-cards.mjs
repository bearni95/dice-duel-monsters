#!/usr/bin/env node
// Copies the baked, git-tracked card PNGs (authored here, the single source of
// truth) into a consumer's static dir so a static host can serve them at
// /cards/generated/<id>.png. The frontend runs this on dev + build; the admin app
// reads the same files read-through instead (see the endpoints in
// packages/admin/src/routes/print and packages/admin/vite/serve-data-assets.ts),
// so an admin bake shows up without a copy step.
//
// Usage: sync-generated-cards <destStaticDir>   (dest resolved against cwd)

import { mkdirSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'cards', 'generated');

const destArg = process.argv[2];
if (!destArg) {
	console.error('[sync-generated-cards] missing destination static dir');
	process.exit(1);
}
const to = join(resolve(process.cwd(), destArg), 'cards', 'generated');

if (!existsSync(from)) {
	console.log('[sync-generated-cards] nothing to sync — no cards/generated in the assets package');
	process.exit(0);
}

// The assets package is the single source of truth, so mirror it rather than
// merely copying over: a card that was deleted or re-baked (its old PNG removed)
// here must not survive as a stale bitmap in the destination — that is exactly
// how a broken render lingers on after the good one is regenerated.
const sourceFiles = new Set(
	readdirSync(from).filter((f) => statSync(join(from, f)).isFile())
);

mkdirSync(to, { recursive: true });

let removed = 0;
for (const f of readdirSync(to)) {
	const dest = join(to, f);
	if (statSync(dest).isFile() && !sourceFiles.has(f)) {
		rmSync(dest);
		removed++;
	}
}

let copied = 0;
for (const f of sourceFiles) {
	copyFileSync(join(from, f), join(to, f));
	copied++;
}

console.log(
	`[sync-generated-cards] synced ${copied} generated card PNG(s) into ${to}` +
		(removed ? ` (removed ${removed} stale file(s))` : '')
);
