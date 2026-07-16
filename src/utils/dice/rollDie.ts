// Roll a single die with the given number of sides (defaults to a d6).
// Returns an integer in the range [1, sides].
export default function rollDie(sides: number = 6): number {
	return Math.floor(Math.random() * sides) + 1;
}
