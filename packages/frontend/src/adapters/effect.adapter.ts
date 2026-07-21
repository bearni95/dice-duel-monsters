import { AdapterClass } from '$adapters/classes/adapter.class';
import { rollD6 } from '$utils/dice/rollD6';
import {
	CARD_CATEGORIES,
	type CardEffect,
	type EffectKind,
	type EffectParam,
	type EffectParamValues
} from '$types/effect.type';

// Re-exported for the many call sites that import it from the adapter. The type
// itself lives in $types/effect.type so it stays independent of the adapter.
export type { EffectParamValues };

export class EffectAdapter extends AdapterClass {
	constructor() {
		super('effect');
	}

	// Build a blank effect of the given kind, pre-filled with sensible defaults
	// so the editor form always starts from a valid shape.
	createDefault(kind: EffectKind = 'gain-stat'): CardEffect {
		switch (kind) {
			case 'requirement':
				return {
					id: crypto.randomUUID(),
					kind: 'requirement',
					name: 'Requirement',
					requirement: { category: '', subType: '', attribute: '', race: '' }
				};
			case 'destroy':
				return {
					id: crypto.randomUUID(),
					kind: 'destroy',
					name: 'Destroy',
					description: 'Destroy the target'
				};
			case 'flip':
				return {
					id: crypto.randomUUID(),
					kind: 'flip',
					name: 'Flip',
					description: 'Flip this card'
				};
			case 'follow':
				return {
					id: crypto.randomUUID(),
					kind: 'follow',
					name: 'Follow',
					description: 'Follows the card it is equiped to'
				};
			case 'gain-stat':
			default:
				return {
					id: crypto.randomUUID(),
					kind: 'gain-stat',
					name: 'Gain stat',
					description: 'Raise {stat} by {amount}',
					params: [
						{ key: 'stat', label: 'Attribute', type: 'stat', mode: 'templated', defaultValue: 'atk' },
						{ key: 'amount', label: 'Amount', type: 'number', mode: 'templated', defaultValue: 1 }
					]
				};
		}
	}

	// Resolve an effect into human-readable text. Requirement effects list the
	// card criteria that must be met; other effects fill their description
	// template (dice params show their notation, e.g. `3d6`; templated params use
	// the card-supplied `values`, falling back to the param's default; fixed
	// params always use their default).
	toDisplayText(effect: CardEffect, values: EffectParamValues = {}): string {
		if (effect.kind === 'requirement') {
			const { category, subType, attribute, race } = effect.requirement;
			const parts: string[] = [];
			if (category) {
				parts.push(CARD_CATEGORIES.find((c) => c.value === category)?.label ?? category);
			}
			if (subType) parts.push(subType);
			if (race) parts.push(race);
			if (attribute) parts.push(attribute);
			return parts.length ? `Requires ${parts.join(' · ')}` : 'Requires any card';
		}

		if (effect.kind === 'gain-stat') {
			return effect.description.replace(/\{(\w+)\}/g, (match, key: string) => {
				const param = effect.params.find((p) => p.key === key);
				if (!param) return match;
				if (param.mode === 'dice') return `${param.dice ?? 1}d6`;
				const value = param.mode === 'templated' && key in values ? values[key] : param.defaultValue;
				return this.formatParamValue(param, value);
			});
		}

		// Marker effects (destroy, flip) carry a static description, no tokens.
		return effect.description;
	}

	// The template's params that each card fills in when it implements the effect.
	// Only "gain stat" effects carry params; the other kinds have none.
	templatedParams(effect: CardEffect): EffectParam[] {
		return effect.kind === 'gain-stat' ? effect.params.filter((p) => p.mode === 'templated') : [];
	}

	// Resolve a param to a concrete value for game logic: dice params are rolled
	// and summed, templated params take the card-supplied value (falling back to
	// their default), and fixed params return their default.
	resolveParamValue(param: EffectParam, values: EffectParamValues = {}): string | number {
		if (param.mode === 'dice') return rollD6(param.dice ?? 1);
		if (param.mode === 'templated') return param.key in values ? values[param.key] : param.defaultValue;
		return param.defaultValue;
	}

	// Turn a raw param value into its display form (stats show their friendly
	// label rather than the raw key).
	private formatParamValue(param: EffectParam, value: string | number): string {
		if (param.type === 'stat') {
			const labels: Record<string, string> = {
				atk: 'Attack',
				hp: 'HP',
				def: 'Defense',
				cost: 'Cost',
				speed: 'Speed',
				reach: 'Reach'
			};
			return labels[String(value)] ?? String(value);
		}
		return String(value);
	}
}

export const effectAdapter = new EffectAdapter();
