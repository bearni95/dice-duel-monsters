import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';

// Per-card board positioning (a billboard size factor plus an x/y pixel offset of
// the image — its red square — relative to its cell — the purple square),
// persisted as a single JSON map (`cardId -> { size?, x?, y? }`) under
// data/cards/ — the same source tree the catalog is assembled from, so the values
// are baked into static/cards/catalog.json at build time (see
// scripts/build-card-catalog.mjs). Edited from the board-preview modal on
// /admin/cards. Only fields adjusted away from their default (size 1, x/y 0) are
// stored, and a card left fully at the default carries no entry at all.
const FILE = join(process.cwd(), 'data/cards/positions.json');

// Field defaults and the margins within which an incoming value is treated as
// "back to default" and dropped from storage.
const DEFAULT_SIZE = 1;
const SIZE_EPSILON = 1e-4;
const OFFSET_EPSILON = 1e-4;

type CardPosition = { size?: number; x?: number; y?: number };
type PositionsMap = Record<string, CardPosition>;

function read(): PositionsMap {
	if (!existsSync(FILE)) return {};
	try {
		const data = JSON.parse(readFileSync(FILE, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? (data as PositionsMap) : {};
	} catch {
		return {};
	}
}

export const GET: RequestHandler = async () => json(read());

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || (typeof body.cardId !== 'string' && typeof body.cardId !== 'number')) {
		throw error(400, 'A cardId is required.');
	}

	const size = Number(body.size ?? DEFAULT_SIZE);
	if (!Number.isFinite(size) || size <= 0) {
		throw error(400, 'A positive numeric size is required.');
	}

	const x = Number(body.x ?? 0);
	const y = Number(body.y ?? 0);
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		throw error(400, 'Numeric x and y offsets are required.');
	}

	const dir = dirname(FILE);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const cardId = String(body.cardId);
	const map = read();

	// Store only the fields that differ from their default, so a card adjusted in
	// one axis doesn't record redundant defaults for the others.
	const entry: CardPosition = {};
	if (Math.abs(size - DEFAULT_SIZE) >= SIZE_EPSILON) entry.size = size;
	if (Math.abs(x) >= OFFSET_EPSILON) entry.x = x;
	if (Math.abs(y) >= OFFSET_EPSILON) entry.y = y;

	// A fully-default position carries no entry at all.
	if (Object.keys(entry).length === 0) {
		delete map[cardId];
	} else {
		map[cardId] = entry;
	}

	writeFileSync(FILE, `${JSON.stringify(map, null, 2)}\n`);

	// Positioning is baked into static/cards/catalog.json at build time, which is
	// what the board actually renders from. Rebuild it now so the change shows on
	// the board after a reload without waiting for the next `pnpm dev`/build — the
	// same assembly step the dev/build scripts run. A build failure is logged but
	// doesn't fail the save (the position is already persisted).
	rebuildCatalog();

	return json(map);
};

function rebuildCatalog() {
	try {
		execFileSync(process.execPath, [join(process.cwd(), 'scripts/build-card-catalog.mjs')], {
			cwd: process.cwd(),
			stdio: 'ignore'
		});
	} catch (e) {
		console.error('[positions] catalog rebuild failed:', e);
	}
}
