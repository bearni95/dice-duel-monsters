// Turn a 0-based column index into a spreadsheet-style letter (A..Z, AA..).
export function columnLabel(index: number): string {
	let label = '';
	let n = index;

	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);

	return label;
}

// A cell's coordinate in the same letter/number system the old edge headers used:
// its 1-based row number followed by its (capital) column letter (e.g. "1A",
// "10J", "12L"). Painted on a cell while it's hovered.
export function cellLabel(x: number, y: number): string {
	return `${y + 1}${columnLabel(x)}`;
}
