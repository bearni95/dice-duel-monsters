import { AdapterClass } from './classes/adapter.class';
import {
	DICE_FACE_COUNT,
	DICE_RARITY_LEVELS,
	type DiceDefinition,
	type DiceFace,
	type DiceRole,
	type DiceRoleConfig,
	type DiceTemplate,
	type DiceTemplateConfig,
	type DistinctFace,
	type SpawnedDie
} from '$types/dice.type';

// Transforms die definitions (as stored in static/dice/dice.json) into the props
// the 3D dice canvases expect, and wraps the /dice/store CRUD endpoint.
// All die data-shaping lives here so the page and canvas components stay UI-only.
export class DiceAdapter extends AdapterClass {
	constructor() {
		super('dice');
	}

	// The per-face icon URLs, in face order (index 0 => face 1), as IconDiceCanvas3D
	// and DiceFaceViewer take them.
	faceIcons(die: DiceDefinition): string[] {
		return die.faces.map((f) => f.icon);
	}

	// The per-face corner-badge values, in the same order.
	faceLabels(die: DiceDefinition): string[] {
		return die.faces.map((f) => f.value);
	}

	// The die's distinct faces: its six faces deduped by icon+value, each keeping the
	// 1-based index of its first occurrence (so its baked PNG can be located) and how
	// many of the six faces carry it. A face with a count above 1 is a duplicate.
	distinctFaces(die: DiceDefinition): DistinctFace[] {
		const groups = new Map<string, DistinctFace>();
		die.faces.forEach((f, i) => {
			const key = `${f.icon}|${f.value}`;
			const existing = groups.get(key);
			if (existing) existing.count++;
			else groups.set(key, { face: i + 1, icon: f.icon, value: f.value, count: 1 });
		});
		return [...groups.values()];
	}

	// The die's hex tint as the numeric colour the canvases use, or undefined when
	// unset so the canvas falls back to its own default.
	colorNumber(die: DiceDefinition): number | undefined {
		if (!die.color) return undefined;
		const n = parseInt(die.color.replace('#', ''), 16);
		return Number.isNaN(n) ? undefined : n;
	}

	// A fresh, empty die with the right number of blank faces, for the "new die"
	// form. Not persisted until saved.
	blank(): DiceDefinition {
		return {
			id: '',
			name: '',
			color: '#d7382f',
			faces: Array.from({ length: DICE_FACE_COUNT }, (): DiceFace => ({ icon: '', value: '' }))
		};
	}

	// A deep copy so the edit form can be mutated without touching the loaded list
	// until the change is saved.
	clone(die: DiceDefinition): DiceDefinition {
		return { ...die, faces: die.faces.map((f) => ({ ...f })) };
	}

	// --- CRUD against /dice/store (dev-time authoring endpoint) ---------

	async list(): Promise<DiceDefinition[]> {
		const res = await fetch('/dice/store');
		if (!res.ok) throw new Error(`Could not load dice (${res.status})`);
		const data = await res.json();
		return (data?.dice ?? []) as DiceDefinition[];
	}

	async save(die: DiceDefinition): Promise<DiceDefinition> {
		const res = await fetch('/dice/store', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(die)
		});
		if (!res.ok) throw new Error((await res.text()) || `Could not save die (${res.status})`);
		const data = await res.json();
		return data.die as DiceDefinition;
	}

	async remove(id: DiceDefinition['id']): Promise<void> {
		const res = await fetch(`/dice/store?id=${encodeURIComponent(String(id))}`, {
			method: 'DELETE'
		});
		if (!res.ok) throw new Error(`Could not delete die (${res.status})`);
	}

	// --- Templates -----------------------------------------------------------

	// The template config the game spawns its dice from, read straight from the
	// static JSON (no server needed — the file is the source of truth).
	async loadTemplates(): Promise<DiceTemplateConfig> {
		const res = await fetch('/dice/templates.json', { cache: 'no-store' });
		if (!res.ok) throw new Error(`Could not load dice templates (${res.status})`);
		return (await res.json()) as DiceTemplateConfig;
	}

	// Spawn one concrete die from a template at a given rarity: the rarity fixes the
	// body colour (pride-flag order) and each face's value — the rarity level, or
	// rarity + 1 on the "bumped" faces (the two off-role faces and half the on-role
	// faces).
	spawn(config: DiceTemplateConfig, template: DiceTemplate, rarity: number): SpawnedDie {
		return {
			id: `${template.id}-r${rarity}`,
			name: `${template.name} — Rarity ${rarity}`,
			color: config.rarityColors[rarity - 1],
			templateId: template.id,
			role: template.role,
			rarity,
			faces: template.faces.map(
				(f): DiceFace => ({
					icon: config.roles[f.role].icon,
					value: String(rarity + (f.bump ? 1 : 0))
				})
			)
		};
	}

	// Every die the game can produce: each template crossed with every rarity level.
	spawnAll(config: DiceTemplateConfig): SpawnedDie[] {
		const out: SpawnedDie[] = [];
		for (const template of config.templates) {
			for (const rarity of DICE_RARITY_LEVELS) out.push(this.spawn(config, template, rarity));
		}
		return out;
	}

	// --- Energy dice (turn-start rolls on the board) ---------------------------

	// An icon→role lookup for the config, so a landed face can be traced back to the
	// role it scores. Each role carries a distinct icon (see the roles map), so the
	// icon painted on a face is enough to recover which pool it feeds.
	roleByIcon(config: DiceTemplateConfig): Map<string, DiceRole> {
		return new Map(
			(Object.entries(config.roles) as [DiceRole, DiceRoleConfig][]).map(([role, cfg]) => [
				cfg.icon,
				role
			])
		);
	}

	// The role and numeric value a die contributes when it lands on `face` (its
	// 1-based face index). The role is recovered from the face's icon; the value is
	// the number baked on that face. Returns null for an out-of-range face or an
	// icon that maps to no role.
	faceEnergy(
		config: DiceTemplateConfig,
		die: DiceDefinition,
		face: number,
		roleByIcon?: Map<string, DiceRole>
	): { role: DiceRole; value: number } | null {
		const f = die.faces[face - 1];
		if (!f) return null;
		const role = (roleByIcon ?? this.roleByIcon(config)).get(f.icon);
		if (!role) return null;
		const value = parseInt(f.value, 10);
		return { role, value: Number.isNaN(value) ? 0 : value };
	}

}

export const diceAdapter = new DiceAdapter();
