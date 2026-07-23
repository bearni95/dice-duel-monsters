import { describe, it, expect } from 'vitest';
import { orderedDieFaces } from '$utils/dice/staticDie';

// The isometric cube shows three of a die's faces — the highest value turned up, the
// next two on the sides. orderedDieFaces is the pure ranking that decides which, so it
// can be checked without a canvas.

describe('orderedDieFaces', () => {
	it('crowns the highest-value face and fills the sides with the next two', () => {
		// Values by face index (1-based): face 4 is highest, then 6, then 2.
		const { top, left, right } = orderedDieFaces([1, 3, 1, 6, 2, 5]);
		// Highest (6) is face 4 → top; next (5) is face 6 → left; next (3) is face 2 → right.
		expect(top).toBe(4);
		expect(left).toBe(6);
		expect(right).toBe(2);
	});

	it('breaks value ties by the lower face index', () => {
		const { top, left, right } = orderedDieFaces([5, 5, 5, 1, 1, 1]);
		expect([top, left, right]).toEqual([1, 2, 3]);
	});

	it('always returns three defined faces even when values are missing', () => {
		const { top, left, right } = orderedDieFaces([NaN, NaN, NaN, NaN, NaN, NaN]);
		for (const face of [top, left, right]) {
			expect(face).toBeGreaterThanOrEqual(1);
			expect(face).toBeLessThanOrEqual(6);
		}
	});
});
