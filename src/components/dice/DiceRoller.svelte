<script lang="ts">
	import classNames from 'classnames';
	import rollDie from '$utils/dice/rollDie';

	// Energy points counter, owned by the parent so it can drive game state.
	let { energyPoints = 0, onRoll }: {
		energyPoints?: number;
		onRoll?: (total: number) => void;
	} = $props();

	// Two 1d6 dice, one per square. Start unrolled (null face).
	const DICE_COUNT = 2;
	let faces = $state<(number | null)[]>(Array(DICE_COUNT).fill(null));

	// Once rolled, the turn is spent: roll is disabled until "End Turn".
	let rolled = $state(false);

	function roll() {
		if (rolled) return;

		faces = faces.map(() => rollDie(6));

		const total = faces.reduce((sum: number, face) => sum + (face ?? 0), 0);

		rolled = true;
		onRoll?.(total);
	}

	// Restart the turn: clear the dice and re-enable rolling.
	function endTurn() {
		faces = Array(DICE_COUNT).fill(null);
		rolled = false;
	}
</script>

<div class="flex items-center justify-between gap-3 border-b border-base-300 p-2">
	<div class="flex gap-1">
		{#each faces as face, i (i)}
			<div
				class={classNames(
					'flex h-8 w-8 items-center justify-center rounded border border-base-300 text-sm font-semibold',
					{
						'bg-base-200 text-base-content/40': face === null,
						'bg-base-100': face !== null
					}
				)}
			>
				{face ?? '–'}
			</div>
		{/each}
	</div>

	<div class="flex items-center gap-3">
		<span class="badge badge-success gap-1">
			Energy: {energyPoints}
		</span>

		<button class="btn btn-primary btn-sm" onclick={roll} disabled={rolled}>
			Roll
		</button>

		{#if rolled}
			<button class="btn btn-outline btn-sm" onclick={endTurn}> End Turn </button>
		{/if}
	</div>
</div>
