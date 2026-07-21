<script lang="ts">
	// The dice-status panel. The 3D dice themselves now render on the board canvas
	// (see Dice3D in the board page), and both the turn number and each side's energy
	// total are drawn on the board too (beside the origin dice rows). This panel is left
	// with only the transient "Rolling…" indicator shown while a throw is tumbling.
	let {
		rolling = false
	}: {
		// Whether an on-board dice throw is tumbling (shown as a rolling indicator).
		rolling?: boolean;
	} = $props();
</script>

{#if rolling}
	<div class="flex items-center gap-1 rounded bg-base-100 p-2 text-xs opacity-70 shadow-sm">
		<span class="loading loading-spinner loading-xs"></span>
		Rolling…
	</div>
{/if}
