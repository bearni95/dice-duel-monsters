import { describe, expect, it } from 'vitest';
import { isSystemMonster } from '$utils/cards/card-query';

describe('isSystemMonster', () => {
	it('accepts the monster kinds the game summons', () => {
		for (const type of [
			'Normal Monster',
			'Effect Monster',
			'Flip Effect Monster',
			'Fusion Monster',
			'Ritual Monster',
			'Ritual Effect Monster',
			'Tuner Monster'
		]) {
			expect(isSystemMonster({ type })).toBe(true);
		}
	});

	it('rejects the extra-deck varieties the board has no rules for', () => {
		for (const type of [
			'Synchro Monster',
			'Synchro Tuner Monster',
			'XYZ Monster',
			'XYZ Pendulum Effect Monster',
			'Pendulum Effect Monster',
			'Pendulum Normal Monster'
		]) {
			expect(isSystemMonster({ type })).toBe(false);
		}
	});

	it('rejects everything that is not a monster', () => {
		for (const type of ['Spell Card', 'Trap Card', 'Skill Card', 'Token']) {
			expect(isSystemMonster({ type })).toBe(false);
		}
	});
});
