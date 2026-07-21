<script lang="ts">
	import classNames from 'classnames';
	import { untrack } from 'svelte';
	import { diceAdapter } from '$adapters/dice.adapter';
	import DiceDistinctFaces from '$components/dice/DiceDistinctFaces.svelte';
	import type { SpawnedDie } from '$types/dice.type';

	// The turn-start dice picker: a modal the player uses to choose which of their
	// owned dice to roll for energy. Pure UI — the board engine owns the pick phase
	// (`pickingDice`), supplies the pool and how many to pick, and does the rolling
	// when `onconfirm` fires with the chosen dice. Only shown when the player has a
	// genuine choice (more owned dice than the roll uses); otherwise the engine rolls
	// the whole pool without prompting.
	let {
		pool,
		pickCount,
		onconfirm
	}: {
		pool: SpawnedDie[];
		pickCount: number;
		onconfirm: (dice: SpawnedDie[]) => void;
	} = $props();

	// One row per distinct die (type × level) the player owns, with how many copies —
	// rather than a card per identical copy. The player then chooses how many of each
	// to roll. Deduped by die id, order preserved from the pool.
	interface DiceGroup {
		die: SpawnedDie;
		count: number;
	}
	let groups = $derived.by<DiceGroup[]>(() => {
		const byId = new Map<string, DiceGroup>();
		for (const die of pool) {
			const g = byId.get(die.id);
			if (g) g.count++;
			else byId.set(die.id, { die, count: 1 });
		}
		return [...byId.values()];
	});

	// How many of each distinct die the player has chosen to roll, keyed by die id.
	// Seeded so the roll count is already met — filled greedily across the groups (up
	// to each group's owned count) so the player can just hit Roll or adjust first.
	// The component remounts for each turn's pick (the board only renders it while
	// `pickingDice` is true), so capturing the initial pool here is exactly the intent.
	let chosen = $state<Record<string, number>>(
		untrack(() => {
			const seed: Record<string, number> = {};
			let left = pickCount;
			for (const die of pool) {
				if (left <= 0) break;
				seed[die.id] = (seed[die.id] ?? 0) + 1;
				left--;
			}
			return seed;
		})
	);

	let total = $derived(Object.values(chosen).reduce((sum, n) => sum + n, 0));
	let canRoll = $derived(total === pickCount);

	function qty(id: string): number {
		return chosen[id] ?? 0;
	}

	function inc(group: DiceGroup) {
		if (total >= pickCount || qty(group.die.id) >= group.count) return;
		chosen = { ...chosen, [group.die.id]: qty(group.die.id) + 1 };
	}

	function dec(group: DiceGroup) {
		if (qty(group.die.id) <= 0) return;
		chosen = { ...chosen, [group.die.id]: qty(group.die.id) - 1 };
	}

	function roll() {
		if (!canRoll) return;
		// Expand each chosen quantity back into that many copies of the die.
		const dice: SpawnedDie[] = [];
		for (const { die } of groups) {
			for (let i = 0; i < qty(die.id); i++) dice.push(die);
		}
		onconfirm(dice);
	}
</script>

<div
	class="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Pick dice to roll for energy"
>
	<div class="card w-full max-w-lg bg-base-100 shadow-2xl">
		<div class="card-body gap-4">
			<div>
				<h2 class="card-title">Pick your energy dice</h2>
				<p class="text-base-content/60 text-sm">
					Choose {pickCount}
					{pickCount === 1 ? 'die' : 'dice'} to roll this turn. Each face you roll adds its value to the
					matching energy pool.
				</p>
			</div>

			<div class="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
				{#each groups as group (group.die.id)}
					{@const selected = qty(group.die.id) > 0}
					<div
						class={classNames(
							'flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-colors',
							selected ? 'border-primary bg-primary/10' : 'border-base-200 bg-base-200'
						)}
					>
						<DiceDistinctFaces dieId={group.die.id} faces={diceAdapter.distinctFaces(group.die)} />
						<span class="text-base-content/80 text-xs font-semibold capitalize">
							{group.die.role} · R{group.die.rarity}
						</span>
						<span class="text-base-content/50 text-[10px]">owned ×{group.count}</span>

						<div class="mt-1 flex items-center gap-1">
							<button
								type="button"
								class="btn btn-circle btn-xs"
								aria-label={`Roll one fewer ${group.die.name}`}
								disabled={qty(group.die.id) <= 0}
								onclick={() => dec(group)}
							>
								−
							</button>
							<span class="w-5 text-center text-sm font-bold tabular-nums">
								{qty(group.die.id)}
							</span>
							<button
								type="button"
								class="btn btn-circle btn-xs"
								aria-label={`Roll one more ${group.die.name}`}
								disabled={total >= pickCount || qty(group.die.id) >= group.count}
								onclick={() => inc(group)}
							>
								+
							</button>
						</div>
					</div>
				{/each}
			</div>

			<div class="card-actions items-center justify-between">
				<span class="text-base-content/60 text-sm">{total}/{pickCount} selected</span>
				<button class="btn btn-primary" disabled={!canRoll} onclick={roll}>Roll</button>
			</div>
		</div>
	</div>
</div>
