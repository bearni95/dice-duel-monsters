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

	// Dice are picked by their position in the pool (duplicates are distinct picks).
	// Seed the selection with the first `pickCount` so the player can just hit Roll,
	// or swap in different dice first. The component remounts for each turn's pick
	// (the board only renders it while `pickingDice` is true), so capturing the pool's
	// initial value here is exactly the intent — untrack keeps it a one-time seed.
	let selected = $state<Set<number>>(
		untrack(() => new Set(pool.map((_, i) => i).slice(0, pickCount)))
	);

	let count = $derived(selected.size);
	let canRoll = $derived(count === pickCount);

	function toggle(i: number) {
		const next = new Set(selected);
		if (next.has(i)) next.delete(i);
		// Ignore extra picks past the limit; the player deselects one first.
		else if (next.size < pickCount) next.add(i);
		selected = next;
	}

	function roll() {
		if (!canRoll) return;
		onconfirm([...selected].map((i) => pool[i]));
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

			<div class="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
				{#each pool as die, i (i)}
					<button
						type="button"
						class={classNames(
							'flex flex-col items-center gap-1 rounded-lg border-2 p-2 transition-colors',
							selected.has(i)
								? 'border-primary bg-primary/10'
								: 'border-transparent bg-base-200 hover:border-base-300'
						)}
						aria-pressed={selected.has(i)}
						aria-label={die.name}
						title={die.name}
						onclick={() => toggle(i)}
					>
						<DiceDistinctFaces dieId={die.id} faces={diceAdapter.distinctFaces(die)} />
						<span class="text-base-content/70 truncate text-[10px] font-medium capitalize">
							{die.role} · R{die.rarity}
						</span>
					</button>
				{/each}
			</div>

			<div class="card-actions items-center justify-between">
				<span class="text-base-content/60 text-sm">{count}/{pickCount} selected</span>
				<button class="btn btn-primary" disabled={!canRoll} onclick={roll}>Roll</button>
			</div>
		</div>
	</div>
</div>
