<script lang="ts">
	// The turn/dice panel. The 3D dice themselves now render on the board canvas
	// (see Dice3D in the board page): the player's energy at a fixed anchor box, and
	// a summoned creature's HP dice floating above it. This panel owns only the
	// read-out (turn, energy totals); the turn actions (Unfold / End Turn) now live in
	// the hand row's detail cell on the board page.
	let {
		energyPoints = 0,
		rivalEnergy = 0,
		turnNumber = 1,
		rolling = false
	}: {
		energyPoints?: number;
		// The rival's remaining energy, shown as a read-only mirror.
		rivalEnergy?: number;
		// The shared turn number, shown as a read-only banner.
		turnNumber?: number;
		// Whether an on-board dice throw is tumbling (shown as a rolling indicator).
		rolling?: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-2 p-2">
	<div class="flex items-center justify-between gap-3 border-b border-base-300 pb-1">
		<span class="badge badge-neutral gap-1">Turn {turnNumber}</span>
		{#if rolling}
			<span class="flex items-center gap-1 text-xs opacity-70">
				<span class="loading loading-spinner loading-xs"></span>
				Rolling…
			</span>
		{/if}
	</div>

	<div class="grid grid-cols-2 gap-2">
		<span class="badge badge-success w-full gap-1">
			You: {energyPoints}
			<span
				class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
				aria-label="Energy"
				title="Energy"
			></span>
		</span>
		<span class="badge badge-info w-full gap-1">
			Rival: {rivalEnergy}
			<span
				class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
				aria-label="Energy"
				title="Energy"
			></span>
		</span>
	</div>
</div>
