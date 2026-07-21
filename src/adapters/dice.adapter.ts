import { AdapterClass } from './classes/adapter.class';
import {
	DICE_FACE_COUNT,
	DICE_RARITY_LEVELS,
	type DiceDefinition,
	type DiceFace,
	type DiceTemplate,
	type DiceTemplateConfig,
	type OwnedDiceGrid,
	type SpawnedDie
} from '$types/dice.type';

// Transforms die definitions (as stored in static/dice/dice.json) into the props
// the 3D dice canvases expect, and wraps the /admin/dice/store CRUD endpoint.
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

	// --- CRUD against /admin/dice/store (dev-time authoring endpoint) ---------

	async list(): Promise<DiceDefinition[]> {
		const res = await fetch('/admin/dice/store');
		if (!res.ok) throw new Error(`Could not load dice (${res.status})`);
		const data = await res.json();
		return (data?.dice ?? []) as DiceDefinition[];
	}

	async save(die: DiceDefinition): Promise<DiceDefinition> {
		const res = await fetch('/admin/dice/store', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(die)
		});
		if (!res.ok) throw new Error((await res.text()) || `Could not save die (${res.status})`);
		const data = await res.json();
		return data.die as DiceDefinition;
	}

	async remove(id: DiceDefinition['id']): Promise<void> {
		const res = await fetch(`/admin/dice/store?id=${encodeURIComponent(String(id))}`, {
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

	// --- Player-owned dice -----------------------------------------------------

	// Resolve a list of owned spawned-die ids (as stored on the player) into the
	// concrete SpawnedDie definitions, in the same order. Unknown ids are skipped.
	// Duplicates are preserved, since a player may own the same die many times.
	resolveOwned(config: DiceTemplateConfig, ownedIds: string[]): SpawnedDie[] {
		const byId = new Map(this.spawnAll(config).map((die) => [die.id, die]));
		return ownedIds.map((id) => byId.get(id)).filter((die): die is SpawnedDie => die != null);
	}

	// The distinct dice a player owns: one entry per (template, rarity) combination
	// actually held, each with how many copies. Ordered by rarity then template so a
	// gallery reads level by level.
	ownedUnique(
		config: DiceTemplateConfig,
		ownedIds: string[]
	): { die: SpawnedDie; count: number }[] {
		const counts = ownedIds.reduce<Record<string, number>>((acc, id) => {
			acc[id] = (acc[id] ?? 0) + 1;
			return acc;
		}, {});
		const out: { die: SpawnedDie; count: number }[] = [];
		for (const rarity of DICE_RARITY_LEVELS) {
			for (const template of config.templates) {
				const die = this.spawn(config, template, rarity);
				const count = counts[die.id] ?? 0;
				if (count > 0) out.push({ die, count });
			}
		}
		return out;
	}

	// Tally a player's owned die ids into a rarity-by-type grid (rows = rarity 1..6,
	// columns = templates) for the inventory table. Counts come straight from the
	// ids, which encode `${templateId}-r${rarity}`, so no spawning is needed.
	ownedGrid(config: DiceTemplateConfig, ownedIds: string[]): OwnedDiceGrid {
		const counts = ownedIds.reduce<Record<string, number>>((acc, id) => {
			acc[id] = (acc[id] ?? 0) + 1;
			return acc;
		}, {});
		const templates = config.templates;
		const rarities = [...DICE_RARITY_LEVELS];
		const rows = rarities.map((rarity) => ({
			rarity,
			cells: templates.map((template) => counts[`${template.id}-r${rarity}`] ?? 0)
		}));
		return { templates, rarities, rows };
	}

	// Pick `count` random dice from every die the game can produce, returning their
	// ids (with repeats allowed) so they can be appended to the player's collection.
	randomDiceIds(config: DiceTemplateConfig, count: number): string[] {
		const all = this.spawnAll(config);
		if (all.length === 0) return [];
		return Array.from({ length: count }, () => all[Math.floor(Math.random() * all.length)].id);
	}
}

export const diceAdapter = new DiceAdapter();
