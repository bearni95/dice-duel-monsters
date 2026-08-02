import type { CardAsset } from '$components/cards/GameCard.svelte';
import type { BoosterRarity, PackPull } from '$types/booster.type';

/** How many cards a single booster pack yields. */
export const PACK_SIZE = 9;

/** Slots filled from the common pool; the remaining two are the rare and high-tier slots. */
const COMMON_SLOTS = 7;

export const RARITY_ORDER: Record<BoosterRarity, number> = {
	common: 0,
	rare: 1,
	super: 2,
	ultra: 3,
	secret: 4
};

export const RARITY_LABEL: Record<BoosterRarity, string> = {
	common: 'Common',
	rare: 'Rare',
	super: 'Super Rare',
	ultra: 'Ultra Rare',
	secret: 'Secret Rare'
};

/** Foil tint drawn around a pulled card in the opener canvas. */
export const RARITY_COLOR: Record<BoosterRarity, number> = {
	common: 0xcbd5e1,
	rare: 0x0ea5e9,
	super: 0xa855f7,
	ultra: 0xf59e0b,
	secret: 0xec4899
};

// Cards that cost a summon to put on the board (fusions, rituals and the rest of
// the extra deck) start a tier up, the same way the printed sets treat them.
const SUMMON_COST_TYPES = /Fusion|Ritual|Synchro|XYZ|Link/i;

/**
 * Heuristic rarity classification from the card's intrinsic power. The catalog
 * carries no printed rarity, so ATK stands in for it: the pool is all monsters
 * (see `CardApiAdapter.loadAvailableCards`), and a card's ATK is the one number
 * that tracks how much a player wants to pull it.
 */
export function rarityTierOf(card: CardAsset): BoosterRarity {
	const atk = card.atk ?? 0;
	if (SUMMON_COST_TYPES.test(card.type)) {
		if (atk >= 2800) return 'secret';
		if (atk >= 2400) return 'ultra';
		return 'super';
	}
	if (atk >= 3000) return 'secret';
	if (atk >= 2500) return 'ultra';
	if (atk >= 2000) return 'super';
	if (atk >= 1500) return 'rare';
	return 'common';
}

export function bucketByRarity(cards: CardAsset[]): Record<BoosterRarity, CardAsset[]> {
	const buckets: Record<BoosterRarity, CardAsset[]> = {
		common: [],
		rare: [],
		super: [],
		ultra: [],
		secret: []
	};
	for (const card of cards) buckets[rarityTierOf(card)].push(card);
	return buckets;
}

const HIGH_TIER_WEIGHTS: Array<[Exclude<BoosterRarity, 'common' | 'rare'>, number]> = [
	['super', 0.6],
	['ultra', 0.3],
	['secret', 0.1]
];

const HIGH_TIER_FALLBACK: Record<Exclude<BoosterRarity, 'common' | 'rare'>, BoosterRarity[]> = {
	secret: ['secret', 'ultra', 'super', 'rare', 'common'],
	ultra: ['ultra', 'super', 'secret', 'rare', 'common'],
	super: ['super', 'ultra', 'secret', 'rare', 'common']
};

function pick<T>(arr: T[]): T | null {
	if (arr.length === 0) return null;
	return arr[Math.floor(Math.random() * arr.length)];
}

// Walks `chain` until a tier has something in it, so a pool that is missing a
// tier entirely still fills the slot instead of shipping a short pack.
function pickWithFallback(
	buckets: Record<BoosterRarity, CardAsset[]>,
	chain: BoosterRarity[]
): PackPull | null {
	for (const rarity of chain) {
		const card = pick(buckets[rarity]);
		if (card) return { card, rarity };
	}
	return null;
}

function rollHighTier(): Exclude<BoosterRarity, 'common' | 'rare'> {
	const roll = Math.random();
	let acc = 0;
	for (const [tier, weight] of HIGH_TIER_WEIGHTS) {
		acc += weight;
		if (roll < acc) return tier;
	}
	return 'super';
}

/**
 * Simulate opening one booster pack drawn from `pool`: seven commons, one rare
 * slot and one high-tier slot (super/ultra/secret), sorted with the non-commons
 * first so the reveal grid leads with the good pulls.
 *
 * Every slot falls back through adjacent tiers, so any non-empty pool yields a
 * full nine cards. An empty pool yields none.
 */
export function openPack(pool: CardAsset[]): PackPull[] {
	if (pool.length === 0) return [];

	const buckets = bucketByRarity(pool);
	const pulls: PackPull[] = [];

	for (let i = 0; i < COMMON_SLOTS; i++) {
		const got = pickWithFallback(buckets, ['common', 'rare', 'super', 'ultra', 'secret']);
		if (got) pulls.push(got);
	}

	const rare = pickWithFallback(buckets, ['rare', 'super', 'ultra', 'secret', 'common']);
	if (rare) pulls.push(rare);

	const high = pickWithFallback(buckets, HIGH_TIER_FALLBACK[rollHighTier()]);
	if (high) pulls.push(high);

	return pulls.sort((a, b) => {
		const aCommon = a.rarity === 'common' ? 1 : 0;
		const bCommon = b.rarity === 'common' ? 1 : 0;
		if (aCommon !== bCommon) return aCommon - bCommon;
		return RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity];
	});
}
