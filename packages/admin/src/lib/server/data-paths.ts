import { createRequire } from 'module';
import { dirname, join } from 'path';

// The `data` package is the single source of truth for game data; resolve its
// root from admin's node_modules (it is a workspace dependency). Every admin
// endpoint reads/writes the JSON through these paths so the frontend can serve
// (or sync) the same files.
const require = createRequire(import.meta.url);
const DATA_ROOT = dirname(require.resolve('data/package.json'));

const dataPath = (...segs: string[]): string => join(DATA_ROOT, ...segs);

export const CARDINFO = dataPath('cards', 'cardinfo.json');
export const POSITIONS = dataPath('cards', 'positions.json');
export const CARD_EFFECTS = dataPath('card-effects', 'assignments.json');
export const DECKS_DIR = dataPath('decks');
export const DICE_FILE = dataPath('dice', 'dice.json');
export const SPELLS_FILE = dataPath('spells', 'spells.json');

// The catalog generator and the file it emits (served read-through in dev and
// synced into the frontend's static tree at build).
export const CATALOG_SCRIPT = require.resolve('data/scripts/build-card-catalog.mjs');
export const CATALOG_OUT = dataPath('dist', 'catalog.json');

// Generated card PNGs live in the `assets` package (their git-tracked home, from
// which the frontend syncs them into its static tree). The admin bake endpoints
// read and write them there directly; resolve the dir from that workspace dep.
const ASSETS_ROOT = dirname(require.resolve('assets/package.json'));
export const GENERATED_DIR = join(ASSETS_ROOT, 'cards', 'generated');

// Baked die-face PNGs share that home: one full-resolution PNG per face, exported
// from /dice so both the admin and frontend can serve them as static art.
export const GENERATED_DICE_DIR = join(ASSETS_ROOT, 'dice', 'generated');
