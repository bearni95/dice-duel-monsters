import { AdapterClass } from './classes/adapter.class';
import type { PlayerProfile, ProfileRow, PlayerCardRow } from '$types/player.type';

// Transforms Supabase `profiles` / `player_cards` rows into the shapes the app
// works with, and back. All row-shaping lives here so the service stays a thin
// data-access layer and the page stays UI-only.
export class PlayerAdapter extends AdapterClass {
	constructor() {
		super('player');
	}

	// A `profiles` row into the internal profile shape.
	fromProfileRow(row: ProfileRow): PlayerProfile {
		return {
			id: row.id,
			name: row.name ?? '',
			avatar: row.avatar
		};
	}

	// The row to upsert for a profile save. `updated_at` is left to the database
	// default so the client never sets clock-dependent values.
	toProfileRow(profile: PlayerProfile): ProfileRow {
		return {
			id: profile.id,
			name: profile.name,
			avatar: profile.avatar
		};
	}

	// Expand quantity-per-id `player_cards` rows into a flat list of owned card ids
	// (one entry per copy), which is what the collection UI expects. Rows with a
	// non-positive quantity contribute nothing.
	cardsFromRows(rows: PlayerCardRow[]): number[] {
		const out: number[] = [];
		for (const row of rows) {
			for (let i = 0; i < row.quantity; i++) out.push(row.card_id);
		}
		return out;
	}
}

export const playerAdapter = new PlayerAdapter();
