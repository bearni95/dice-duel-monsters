import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Resolve everything from this script's location, not the cwd: the raw source
// (ref/) and the card index (data/cards/) live in this package, while the
// billboard/full-art PNGs are copied into the frontend package's served static
// tree.
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendRoot = path.resolve(pkgRoot, '../frontend');

const sourceRoot = path.join(pkgRoot, 'ref/DL Assets 29-April-18 v2.6 by Skylex77');
const billboardSource = path.join(sourceRoot, 'duel/monsterbillboard/en-us');
const fullCardSource = path.join(sourceRoot, 'card/en-us/m');
const staticRoot = path.join(frontendRoot, 'static/cards');
const dataRoot = path.join(pkgRoot, 'data/cards');
const billboardDestination = path.join(staticRoot, 'monster-billboards');
const fullCardDestination = path.join(staticRoot, 'full');
const partialDestination = path.join(dataRoot, '.partials');
const titleWhitelist = 'tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -&\'.,:';
const nameOverrides = {
	9402: 'BARBAROID, THE ULTIMATE BATTLE MACHINE',
	10634: 'ARCHFIEND EMPEROR, THE FIRST LORD OF HORROR',
	10823: 'BLACK LUSTER SOLDIER - ENVOY OF THE EVENING TWILIGHT',
	12126: 'BUSTER BLADER, THE DESTRUCTION SWORDMASTER'
};
const finalNameOverrides = {
	4072: 'Kojikocy',
	4073: 'Perfectly Ultimate Great Moth',
	4252: 'One Who Hunts Souls',
	4747: 'Lord of D.',
	5042: 'Mucus Yolk',
	5335: 'Spirit Ryu',
	5428: 'Fushioh Richie',
	5583: 'Kiryu',
	5664: 'Koitsu',
	6256: 'The Light - Hex-Sealed Fusion',
	6423: 'Doitsu',
	6425: 'T.A.D.P.O.L.E.',
	6467: 'Elemental HERO Shining Flare Wingman',
	6878: 'Dark Lucius LV8',
	8082: 'Rai-Mei',
	9452: 'Karakuri Muso mdl 818 "Haipa"',
	9579: 'Doom Donuts',
	10755: 'Bujingi Ibis',
	10987: 'Bujingi Pavo',
	11927: 'The Winged Dragon of Ra - Sphere Mode',
	12153: 'Buster Blader, the Dragon Destroyer Swordsman'
};

function run(command, args, input, binary = false) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
		const stdout = [];
		let stderr = '';
		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				const output = Buffer.concat(stdout);
				resolve(binary ? output : output.toString());
			}
			else reject(new Error(`${command} exited with ${code}: ${stderr}`));
		});
		if (input) child.stdin.end(input);
		else child.stdin.end();
	});
}

function normalizeName(name) {
	return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function trigrams(name) {
	const normalized = normalizeName(name);
	const values = [];
	for (let index = 0; index <= normalized.length - 3; index += 1) values.push(normalized.slice(index, index + 3));
	return [...new Set(values)];
}

function levenshtein(left, right) {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let row = 1; row <= left.length; row += 1) {
		const current = [row];
		for (let column = 1; column <= right.length; column += 1) {
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
			);
		}
		previous = current;
	}
	return previous[right.length];
}

async function readCardName(file) {
	const titleImage = await run('magick', [file, '-crop', '200x17+15+11', '-resize', '600%', 'png:-'], undefined, true);
	return (await run('tesseract', ['stdin', 'stdout', '--psm', '7', '-c', titleWhitelist], titleImage))
		.replace(/\s+/g, ' ')
		.trim();
}

async function mapConcurrent(items, concurrency, mapper) {
	const results = new Array(items.length);
	let next = 0;
	async function worker() {
		while (next < items.length) {
			const index = next++;
			results[index] = await mapper(items[index], index);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, worker));
	return results;
}

await Promise.all([
	mkdir(billboardDestination, { recursive: true }),
	mkdir(fullCardDestination, { recursive: true }),
	mkdir(partialDestination, { recursive: true })
]);

const billboardFiles = (await readdir(billboardSource))
	.filter((file) => /^MBB_\d+\.png$/.test(file))
	.sort();

if (process.argv[2] === '--clean') {
	await rm(partialDestination, { recursive: true, force: true });
	console.log('Removed the temporary import batches');
	process.exit(0);
}

if (process.argv[2] === '--canonical') {
	const [cardsFile, catalogFile] = process.argv.slice(3);
	if (!cardsFile || !catalogFile) throw new Error('Pass the cards index and a YGOProDeck card catalog');
	const index = JSON.parse(await readFile(cardsFile, 'utf8'));
	const catalog = JSON.parse(await readFile(catalogFile, 'utf8')).data;
	const canonical = [...new Map(catalog.map((card) => [normalizeName(card.name), card.name])).values()];
	const exact = new Map(canonical.map((name) => [normalizeName(name), name]));
	const trigramIndex = new Map();
	for (const name of canonical) {
		for (const trigram of trigrams(name)) {
			const entries = trigramIndex.get(trigram) ?? [];
			entries.push(name);
			trigramIndex.set(trigram, entries);
		}
	}
	const unresolved = [];
	for (const card of index.cards) {
		if (finalNameOverrides[card.id]) {
			card.name = finalNameOverrides[card.id];
			continue;
		}
		const normalized = normalizeName(card.name);
		if (exact.has(normalized)) {
			card.name = exact.get(normalized);
			continue;
		}
		const candidates = new Map();
		for (const trigram of trigrams(card.name)) {
			for (const name of trigramIndex.get(trigram) ?? []) candidates.set(name, (candidates.get(name) ?? 0) + 1);
		}
		const best = [...candidates]
			.sort(([, left], [, right]) => right - left)
			.slice(0, 100)
			.map(([name]) => ({ name, distance: levenshtein(normalized, normalizeName(name)) }))
			.sort((left, right) => left.distance - right.distance)[0];
		const similarity = best ? 1 - best.distance / Math.max(normalized.length, normalizeName(best.name).length) : 0;
		if (best && similarity >= 0.6) card.name = best.name;
		else unresolved.push({ id: card.id, name: card.name, candidate: best?.name, similarity });
	}
	await writeFile(cardsFile, `${JSON.stringify(index, null, '\t')}\n`);
	console.log(`Canonicalized ${index.cards.length - unresolved.length}/${index.cards.length} names`);
	if (unresolved.length) console.log(JSON.stringify(unresolved, null, 2));
	process.exit(0);
}

if (process.argv[2] === '--combine') {
	const partialFiles = Array.from({ length: Math.ceil(billboardFiles.length / 250) }, (_, index) => {
		const start = index * 250;
		return `${start}-${Math.min(start + 250, billboardFiles.length)}.json`;
	});
	const cards = (await Promise.all(partialFiles.map(async (file) => JSON.parse(await readFile(path.join(partialDestination, file), 'utf8')))))
		.flat()
		.sort((a, b) => a.id - b.id);
	if (cards.length !== billboardFiles.length) throw new Error(`Expected ${billboardFiles.length} cards, found ${cards.length}`);
	await writeFile(path.join(dataRoot, 'cards.json'), `${JSON.stringify({ cards }, null, '\t')}\n`);
	console.log(`Wrote ${cards.length} cards to data/cards/cards.json`);
	process.exit(0);
}

const start = Number.parseInt(process.argv[2] ?? '0', 10);
const end = Math.min(Number.parseInt(process.argv[3] ?? String(billboardFiles.length), 10), billboardFiles.length);
if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw new Error('Pass a valid start and end index');
const batch = billboardFiles.slice(start, end);

const cards = await mapConcurrent(batch, 12, async (billboardFile, index) => {
	const id = Number.parseInt(billboardFile.match(/\d+/)[0], 10);
	const fullCardFile = `${id}.png`;
	const fullCardPath = path.join(fullCardSource, fullCardFile);

	await Promise.all([
		copyFile(path.join(billboardSource, billboardFile), path.join(billboardDestination, billboardFile)),
		copyFile(fullCardPath, path.join(fullCardDestination, fullCardFile))
	]);

	const name = nameOverrides[id] ?? (await readCardName(fullCardPath));
	if (!name) throw new Error(`Could not read a name for card ${id}`);
	if ((index + 1) % 100 === 0) console.log(`Processed ${start + index + 1}/${billboardFiles.length}`);

	return {
		id,
		name,
		fullImage: `/cards/full/${fullCardFile}`,
		monsterBillboard: `/cards/monster-billboards/${billboardFile}`
	};
});

await writeFile(path.join(partialDestination, `${start}-${end}.json`), JSON.stringify(cards));
console.log(`Wrote batch ${start}-${end}`);
