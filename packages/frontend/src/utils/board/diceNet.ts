// Offsets of an unfolded 6-sided dice net (a "T"/cross shape),
// relative to the crossroads tile where the card is played.
// The long arm points north-west on the isometric board (-x).
export const DICE_NET_OFFSETS: Array<[number, number]> = [
	[0, 0], // crossroads (played tile)
	[0, -1], // north-east arm
	[1, 0], // south-east arm
	[0, 1], // south-west arm
	[-1, 0], // north-west arm (short)
	[-2, 0] // north-west arm (long)
];

// Orthogonal grid neighbors — the cells that share an edge with a tile on the
// isometric board (used to test whether a net tile "touches" another cell).
export const NEIGHBOR_OFFSETS: Array<[number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];

// The dice-net offsets rotated by `rot` 90° clockwise steps. A single step maps
// (dx, dy) -> (-dy, dx).
export function offsetsForRotation(rot: number): Array<[number, number]> {
	let offsets = DICE_NET_OFFSETS;

	for (let i = 0; i < rot; i++) {
		offsets = offsets.map(([dx, dy]) => [-dy, dx] as [number, number]);
	}

	return offsets;
}
