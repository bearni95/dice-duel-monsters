import type { CardAsset } from '$components/cards/GameCard.svelte';

/**
 * A booster pack the player can open. Packs are static definitions (see
 * `$data/boosterPacks`) rather than rows in Supabase — the game ships one pack
 * that draws from the whole grantable pool, so there is nothing per-player to
 * store. Only the cards that come out of a pack are persisted.
 */
export interface BoosterPack {
	id: string;
	/** Printed across the top of the pack art. */
	label: string;
	/** Printed small along the bottom; describes what the pack draws from. */
	category: string;
	/** The card whose cutout is used as the pack's cover art. */
	coverCardId: number | null;
}

/** Print rarities a pulled card can land on. */
export type BoosterRarity = 'common' | 'rare' | 'super' | 'ultra' | 'secret';

/** One of the nine cards a pack yields, with the slot rarity it filled. */
export interface PackPull {
	card: CardAsset;
	rarity: BoosterRarity;
}
