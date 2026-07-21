// The 11 distinct unfoldings (nets) of a six-sided die — every unique way a cube's
// six faces can be flattened onto the grid. Each net is a connected set of six cell
// offsets relative to the crossroads tile (0, 0) where the card is played, so it can
// be stamped as the network floor beneath a summoned creature.
//
// Index 0 is the classic cross/T net the board has always used (its long arm points
// north-west, -x); the other ten are the remaining unique cube nets, offered in the
// in-canvas net picker so the player can pick which shape their network unfolds into.
export const DICE_NETS: Array<Array<[number, number]>> = [
	// 0 — the default cross/T net (long arm north-west on the isometric board).
	[
		[0, 0], // crossroads (played tile)
		[0, -1], // north-east arm
		[1, 0], // south-east arm
		[0, 1], // south-west arm
		[-1, 0], // north-west arm (short)
		[-2, 0] // north-west arm (long)
	],
	// 1..10 — the other ten unique cube nets. Each keeps the crossroads at (0, 0).
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[2, 0],
		[1, -1]
	],
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[2, 0],
		[-1, -1]
	],
	[
		[0, 0],
		[-1, 0],
		[1, 0],
		[-2, 0],
		[-1, 1],
		[1, -1]
	],
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[1, -1],
		[0, 2]
	],
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[0, 1],
		[1, -1],
		[2, -1]
	],
	[
		[0, 0],
		[0, -1],
		[0, 1],
		[1, -1],
		[-1, -1],
		[0, 2]
	],
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[2, 0],
		[-1, 1],
		[2, -1]
	],
	[
		[0, 0],
		[1, 0],
		[-1, 0],
		[1, 1],
		[-1, -1],
		[2, 1]
	],
	[
		[0, 0],
		[-1, 0],
		[0, 1],
		[-2, 0],
		[1, 1],
		[2, 1]
	],
	[
		[0, 0],
		[1, 0],
		[0, 1],
		[1, -1],
		[-1, 1],
		[2, -1]
	]
];

// Offsets of the default unfolded dice net (a "T"/cross shape), kept as a named export
// for callers that don't pick a net — it's simply the first entry of DICE_NETS.
export const DICE_NET_OFFSETS: Array<[number, number]> = DICE_NETS[0];

// Orthogonal grid neighbors — the cells that share an edge with a tile on the
// isometric board (used to test whether a net tile "touches" another cell).
export const NEIGHBOR_OFFSETS: Array<[number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];

// The dice-net offsets rotated by `rot` 90° clockwise steps. A single step maps
// (dx, dy) -> (-dy, dx). `base` selects which net to rotate, defaulting to the classic
// cross so existing callers are unaffected.
export function offsetsForRotation(
	rot: number,
	base: Array<[number, number]> = DICE_NET_OFFSETS
): Array<[number, number]> {
	let offsets = base;

	for (let i = 0; i < rot; i++) {
		offsets = offsets.map(([dx, dy]) => [-dy, dx] as [number, number]);
	}

	return offsets;
}
