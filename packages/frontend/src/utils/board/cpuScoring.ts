// Probability a single d6 lands at or above `threshold` (the value a die must
// meet to count as a hit). 1+ always hits; 7+ never does.
export function pSingleDie(threshold: number): number {
	const faces = Math.max(0, Math.min(6, 7 - threshold));
	return faces / 6;
}

// Probability at least one of `count` d6 lands at or above `threshold` — used to
// judge an attack on the origin cell, which loses exactly 1 LP when any die
// clears its remaining LP.
export function pAnyDie(threshold: number, count: number): number {
	return 1 - Math.pow(1 - pSingleDie(threshold), count);
}
