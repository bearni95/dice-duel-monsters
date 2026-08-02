import { describe, expect, it } from 'vitest';
import type { CardAsset } from '$components/cards/GameCard.svelte';
import type { BoosterRarity } from '$types/booster.type';
import {
	bucketByRarity,
	openPack,
	PACK_SIZE,
	rarityTierOf,
	RARITY_ORDER
} from '$utils/booster/rarityTier';

let nextId = 1;

function card(atk: number, type = 'Effect Monster'): CardAsset {
	return {
		id: nextId++,
		name: `Card ${nextId}`,
		type,
		race: 'Warrior',
		attribute: 'DARK',
		cardImages: [{ image_url_cropped: '' }],
		atk
	};
}

// A pool with every tier represented, so the slot rules can be asserted without
// any fallback kicking in.
function fullPool(): CardAsset[] {
	return [
		card(0),
		card(1000),
		card(1500),
		card(2000),
		card(2500),
		card(3000),
		card(2000, 'Fusion Monster'),
		card(2400, 'Fusion Monster'),
		card(2800, 'Fusion Monster')
	];
}

describe('rarityTierOf', () => {
	it('scales an ordinary monster with its ATK', () => {
		expect(rarityTierOf(card(0))).toBe('common');
		expect(rarityTierOf(card(1499))).toBe('common');
		expect(rarityTierOf(card(1500))).toBe('rare');
		expect(rarityTierOf(card(2000))).toBe('super');
		expect(rarityTierOf(card(2500))).toBe('ultra');
		expect(rarityTierOf(card(3000))).toBe('secret');
	});

	it('starts cards that cost a summon a tier up', () => {
		expect(rarityTierOf(card(0, 'Fusion Monster'))).toBe('super');
		expect(rarityTierOf(card(2400, 'Ritual Monster'))).toBe('ultra');
		expect(rarityTierOf(card(2800, 'Ritual Effect Monster'))).toBe('secret');
	});

	it('treats a missing ATK as zero', () => {
		const noAtk: CardAsset = { ...card(0) };
		delete noAtk.atk;
		expect(rarityTierOf(noAtk)).toBe('common');
	});
});

describe('bucketByRarity', () => {
	it('files every card under exactly one tier', () => {
		const pool = fullPool();
		const buckets = bucketByRarity(pool);
		const total = Object.values(buckets).reduce((n, cards) => n + cards.length, 0);
		expect(total).toBe(pool.length);
		expect(buckets.common.map((c) => c.id)).toEqual([pool[0].id, pool[1].id]);
	});
});

describe('openPack', () => {
	it('yields nothing from an empty pool', () => {
		expect(openPack([])).toEqual([]);
	});

	it('yields nine cards', () => {
		expect(openPack(fullPool())).toHaveLength(PACK_SIZE);
	});

	it('fills seven common slots, one rare slot and one high tier slot', () => {
		const counts: Partial<Record<BoosterRarity, number>> = {};
		for (const pull of openPack(fullPool())) {
			counts[pull.rarity] = (counts[pull.rarity] ?? 0) + 1;
		}
		expect(counts.common).toBe(7);
		expect(counts.rare).toBe(1);
		expect((counts.super ?? 0) + (counts.ultra ?? 0) + (counts.secret ?? 0)).toBe(1);
	});

	it('leads with the rarest pulls and trails with the commons', () => {
		const pulls = openPack(fullPool());
		const commonsStart = pulls.findIndex((pull) => pull.rarity === 'common');
		expect(commonsStart).toBe(2);
		expect(pulls.slice(commonsStart).every((pull) => pull.rarity === 'common')).toBe(true);
		expect(RARITY_ORDER[pulls[0].rarity]).toBeGreaterThanOrEqual(RARITY_ORDER[pulls[1].rarity]);
	});

	it('still fills a full pack from a pool with only one tier in it', () => {
		const pulls = openPack([card(0), card(100)]);
		expect(pulls).toHaveLength(PACK_SIZE);
		expect(pulls.every((pull) => pull.rarity === 'common')).toBe(true);
	});

	it('falls back down the tiers when the commons are missing', () => {
		const pulls = openPack([card(3000)]);
		expect(pulls).toHaveLength(PACK_SIZE);
		expect(pulls.every((pull) => pull.rarity === 'secret')).toBe(true);
	});

	it('only ever pulls cards that are in the pool', () => {
		const pool = fullPool();
		const ids = new Set(pool.map((c) => c.id));
		expect(openPack(pool).every((pull) => ids.has(pull.card.id))).toBe(true);
	});
});
