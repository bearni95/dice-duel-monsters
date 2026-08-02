import type { BoosterPack } from '$types/booster.type';

/**
 * The booster packs on offer. One pack for now: it draws from the whole
 * grantable pool, so there is no per-pack card list to maintain — a card becomes
 * pullable the moment it has art committed and lands in the pool
 * (`CardApiAdapter.loadAvailableCards`).
 *
 * `coverCardId` only chooses the art on the wrapper; it has no bearing on what
 * the pack can yield.
 */
export const boosterPacks: BoosterPack[] = [
	{
		id: 'guardian-core',
		label: 'Guardian Core',
		category: 'Every guardian in the game',
		coverCardId: 25833572
	}
];

/** The pack the /booster page opens. */
export const defaultBoosterPack: BoosterPack = boosterPacks[0];
