import { AdapterClass } from './classes/adapter.class';
import type { ParsedDeck } from '$utils/deck/parseYdk';
import type { YgoProDeckApiDeck } from '$types/ygoprodeck.type';

// A ygoprodeck community deck, transformed into our internal card-id sections
// plus its display name — ready to preview and to save as a Deck.
export interface ImportableDeck extends ParsedDeck {
	name: string;
}

export class YgoProDeckAdapter extends AdapterClass {
	constructor() {
		super('ygoprodeck-deck');
	}

	// The API ships each section as a stringified JSON array of id strings, e.g.
	// "[\"89631139\",\"89631139\"]". Parse it into a number[], preserving copy
	// counts and dropping anything non-numeric.
	parseCardIds(raw: string): number[] {
		if (!raw || raw === '[]') return [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map((id) => parseInt(String(id), 10))
				.filter((id) => Number.isFinite(id) && id > 0);
		} catch {
			return [];
		}
	}

	// Convert a raw API deck into the internal, importable format.
	fromApiDeck(apiDeck: YgoProDeckApiDeck): ImportableDeck {
		return {
			name: apiDeck.deck_name,
			main: this.parseCardIds(apiDeck.main_deck),
			extra: this.parseCardIds(apiDeck.extra_deck),
			side: this.parseCardIds(apiDeck.side_deck)
		};
	}
}

export const ygoProDeckAdapter = new YgoProDeckAdapter();
