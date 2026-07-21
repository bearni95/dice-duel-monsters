#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dir = join(fileURLToPath(import.meta.url), '..');
const root = join(__dir, '..');

// Helpers
function sql(sql) {
	const raw = execSync(`sqlite3 "${root}/app.db" ".separator |" "${sql.replace(/"/g, '\\"')}"`, {
		encoding: 'utf8'
	});
	if (!raw.trim()) return [];
	return raw.split('\n').map((l) => l.split('|'));
}

const typeLabels = {
	1: 'Normal Monster',
	2: 'Effect Monster',
	3: 'Fusion Monster',
	4: 'Ritual Monster',
	5: 'Spirit Monster',
	6: 'Union Monster',
	7: 'Synchron Monster',
	8: 'Tuner Monster',
	16: 'Quick-Play Spell',
	17: 'Normal Spell',
	18: 'Field Spell',
	20: 'Target Spell',
	21: 'Continuous Spell',
	32: 'Counter Trap',
	33: 'Normal Trap',
	64: 'Continuous Trap'
};

const typePendulumMask = { 257: '[ Pendulum ]' }; // 1|256 or 2|256 etc.
const attrLabels = {
	1: 'DARK',
	2: 'DIVINE',
	4: 'EARTH',
	8: 'FIRE',
	16: 'LIGHT',
	32: 'WATER',
	64: 'WIND'
};

function getType(t) {
	if (!t || t === '0') return 'Unknown';
	const base = parseInt(t) & 0xff;
	return typeLabels[base] || `Type ${t}`;
}

function getAttr(a) {
	if (!a || a === '0') return null;
	const n = parseInt(a);
	return attrLabels[n] || `A${n}`;
}

function getRace(r) {
	if (!r || r === '0') return null;
	const n = parseInt(r);
	const races = {
		1: 'Divine-Beast',
		2: 'Dinosaur',
		4: 'Machine',
		8: 'Wave',
		32: 'Spellcaster',
		64: 'Beast-Warrior',
		128: 'Beast',
		512: 'Thunder-Dragon',
		1024: 'Fairy',
		2048: 'Fiend',
		4096: 'Zombie',
		8192: 'Dragon',
		16384: 'Reptile',
		32768: 'Sea-Serpent',
		65536: 'Plantic'
	};
	for (const [bit, label] of Object.entries(races)) {
		if ((n & parseInt(bit)) === parseInt(bit)) return label;
	}
	return `Race${r}`;
}

// Load text names
const texts = sql('SELECT id, name FROM texts ORDER BY id');
const nameMap = new Map(texts.map(([idStr, name]) => [+idStr, name]));

// Load data fields
const datas = sql('SELECT id, type, attribute, race, atk, def FROM datas ORDER BY id');
const dataMap = new Map(
	datas.map((r) => [
		+r[0],
		{
			type: +r[1] || null,
			attribute: +r[2] || null,
			race: +r[3] || null,
			atk: r[4] ? +r[4] : null,
			def: r[5] ? +r[5] : null
		}
	])
);

// Load existing card images
let imageMap = new Map();
try {
	const cardsJson = JSON.parse(readFileSync(join(root, 'cards/cards.json'), 'utf8'));
	for (const c of cardsJson.cards) imageMap.set(c.id, c);
	console.log(`Loaded ${imageMap.size} card images from cards/cards.json`);
} catch {}

// Build combined output
const allIds = [...new Set([...nameMap.keys(), ...dataMap.keys(), ...imageMap.keys()])].sort(
	(a, b) => a - b
);
const cards = [];
for (const id of allIds) {
	const d = dataMap.get(id) || {};
	const img = imageMap.get(id) || {};
	cards.push({
		id,
		name: nameMap.get(id) || 'Unknown',
		fullImage: img.fullImage || null,
		monsterBillboard: img.monsterBillboard || null,
		type: d.type ?? null,
		typeLabel: getType(d.type),
		attribute: d.attribute,
		attributeLabel: getAttr(d.attribute) ?? null,
		race: d.race,
		raceLabel: getRace(d.race),
		atk: d.atk,
		def: d.def
	});
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/cards-db.json'), JSON.stringify({ cards }, null, 2));
console.log(`Wrote dist/cards-db.json (${cards.length} cards)`);
