export type DeckSection = 'main' | 'extra' | 'side';

export interface ParsedDeck {
	main: number[];
	extra: number[];
	side: number[];
}

/**
 * Parse a ygopro deck list (.ydk format) into its main/extra/side card-id
 * sections. Duplicate ids are preserved so copy counts survive.
 *
 * Lines beginning with `#main` / `#extra` and `!side` switch the active
 * section; any other `#` line is treated as a comment. Every remaining line is
 * expected to be a single numeric card id.
 */
export function parseYdk(input: string): ParsedDeck {
	const deck: ParsedDeck = { main: [], extra: [], side: [] };

	let section: DeckSection = 'main';

	for (const rawLine of input.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		if (line.startsWith('#') || line.startsWith('!')) {
			const marker = line.slice(1).toLowerCase();
			if (marker.startsWith('extra')) section = 'extra';
			else if (marker.startsWith('side')) section = 'side';
			else if (marker.startsWith('main')) section = 'main';
			// any other `#` line (e.g. `#created by ...`) is a comment
			continue;
		}

		const id = parseInt(line, 10);
		if (Number.isFinite(id)) deck[section].push(id);
	}

	return deck;
}
