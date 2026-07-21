// Download the full-resolution Master Duel monster-type icons from Yugipedia into
// static/assets/types/, one PNG per monster type (Aqua, Beast, Dragon, …).
//
// The icons live in the Yugipedia category "Yu-Gi-Oh! Master Duel Type icons"
// (files named `Type-<Type>-MADU.png`). We hit the MediaWiki API to list the
// category's files, resolve each file's original (full-res) URL via imageinfo,
// then save it under a normalized slug so the card renderer can look an icon up
// straight from a card's `race` string (see src/utils/card/typeIcon.ts).
//
// Usage:  node scripts/import-type-icons.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const API = 'https://yugipedia.com/api.php';
const CATEGORY = 'Category:Yu-Gi-Oh!_Master_Duel_Type_icons';
// The icons are served by the frontend, so write them into its static tree
// (resolved from this script's location, not the cwd).
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');
const destination = path.join(frontendRoot, 'static/assets/types');

// Yugipedia asks automated clients to identify themselves with a descriptive
// User-Agent; requests without one are rejected.
const USER_AGENT = 'dice-guardians-asset-fetch/1.0 (https://github.com/bearni95; bernatcanal@gmail.com)';

// The slug a type icon is saved (and later looked up) under: lowercased with every
// non-alphanumeric character stripped. This collapses the punctuation differences
// between the icon file names (`BeastWarrior`, `SeaSerpent`) and the card `race`
// strings (`Beast-Warrior`, `Sea Serpent`) so both sides resolve to the same key.
function slugForType(type) {
	return type.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The type name embedded in an icon file title, e.g. `File:Type-BeastWarrior-MADU.png`
// -> `BeastWarrior`. Returns null for any category member that isn't a type icon.
function typeFromTitle(title) {
	const match = /^File:Type-(.+)-MADU\.png$/i.exec(title);
	return match ? match[1] : null;
}

async function api(params) {
	const url = new URL(API);
	for (const [key, value] of Object.entries({ format: 'json', ...params })) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
	if (!response.ok) {
		throw new Error(`API request failed (${response.status}) for ${url}`);
	}
	return response.json();
}

// The file titles in the icon category.
async function listIconFiles() {
	const data = await api({
		action: 'query',
		list: 'categorymembers',
		cmtitle: CATEGORY,
		cmtype: 'file',
		cmlimit: '500'
	});
	return (data.query?.categorymembers ?? []).map((member) => member.title);
}

// The original (full-res) download URL for a batch of file titles, keyed by title.
async function originalUrls(titles) {
	const data = await api({
		action: 'query',
		titles: titles.join('|'),
		prop: 'imageinfo',
		iiprop: 'url'
	});

	const urls = new Map();
	for (const page of Object.values(data.query?.pages ?? {})) {
		const url = page.imageinfo?.[0]?.url;
		if (page.title && url) urls.set(page.title, url);
	}
	return urls;
}

async function main() {
	await mkdir(destination, { recursive: true });

	const titles = (await listIconFiles()).filter((title) => typeFromTitle(title));
	if (!titles.length) {
		throw new Error('No type-icon files found in the category — did the category move?');
	}

	const urls = await originalUrls(titles);

	let saved = 0;
	for (const title of titles) {
		const type = typeFromTitle(title);
		const url = urls.get(title);
		if (!url) {
			console.warn(`! no image URL for ${title}`);
			continue;
		}

		const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
		if (!response.ok) {
			console.warn(`! failed to download ${url} (${response.status})`);
			continue;
		}

		const slug = slugForType(type);
		const file = path.join(destination, `${slug}.png`);
		await writeFile(file, Buffer.from(await response.arrayBuffer()));
		console.log(`✓ ${type.padEnd(14)} -> assets/types/${slug}.png`);
		saved += 1;
	}

	console.log(`\nSaved ${saved}/${titles.length} type icons to ${destination}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
