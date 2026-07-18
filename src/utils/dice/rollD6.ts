// Rolls `count` six-sided dice and returns their summed total. Used by effects
// whose amount is expressed as an amount of d6 rather than a fixed number, e.g.
// a "gain stat" effect that adds the total of 3d6 to an attribute.
export function rollD6(count: number): number {
	let total = 0;
	const dice = Math.max(0, Math.floor(count));
	for (let i = 0; i < dice; i++) {
		total += Math.floor(Math.random() * 6) + 1;
	}
	return total;
}
