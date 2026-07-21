import type { ID } from '$types/core.type';

/**
 * A character portrait ported from the Duel Links sprite set. Each portrait is
 * a single sprite sheet PNG served from `static/characters/`; the face crop is
 * rendered by `CharacterFaceFrame`.
 */
export interface Character {
	/** Stable identifier, matches the portrait file slug. */
	id: ID;
	/** URL-safe slug, e.g. `yami-yugi`. */
	slug: string;
	/** Human-readable display name, e.g. `Yami Yugi`. */
	name: string;
	/** Absolute path to the portrait sprite sheet under `static/`. */
	src: string;
	/** Editor-assigned difficulty rating (1–5), if known. */
	rating: number | null;
	/** Series the character belongs to, e.g. `DM`. */
	series: string | null;
}
