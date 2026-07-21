import type { ID } from '$types/core.type';

/**
 * The local player's profile. Persisted to localStorage via `playerService`
 * so the chosen name and avatar survive across sessions.
 */
export interface Player {
	/** Stable identifier for the single local player record. */
	id: ID;
	/** Player-chosen display name. Empty until the player sets it. */
	name: string;
	/** Chosen avatar, referenced by character slug. `null` until picked. */
	avatar: string | null;
	/**
	 * The dice the player owns, each referenced by its spawned-die id (e.g.
	 * `move-r3`). Any of the definitions under /admin/dice can be owned any number
	 * of times, so duplicates are allowed and order is preserved.
	 */
	dice: string[];
}
