<script lang="ts">
	// The board's right column: the turn/energy read-out, the on-board detail cell and
	// the drawn hand tray, stacked in a real space-occupying flex column beside the
	// canvas (never an overlay). Pure composition — it forwards the board engine to each
	// panel, which reads its state and dispatches its commands.
	import DiceRoller from '$components/dice/DiceRoller.svelte';
	import InspectPanel from '$components/board/InspectPanel.svelte';
	import HandPanel from '$components/board/HandPanel.svelte';
	import type { BoardEngine } from '$services/board-engine.svelte';

	let { engine }: { engine: BoardEngine } = $props();
</script>

<aside
	class="flex h-full w-[var(--right-col-w)] shrink-0 grow-0 flex-col gap-2 overflow-y-auto p-2"
>
	<!-- Turn + energy read-out: the shared turn number and both sides' energy pools. -->
	<div class="rounded bg-base-100 shadow-sm">
		<DiceRoller
			energyPoints={engine.energyPoints}
			rivalEnergy={engine.cpuEnergy}
			turnNumber={engine.turnNumber}
			rolling={engine.rolling}
		/>
	</div>

	<InspectPanel {engine} />

	<HandPanel {engine} />
</aside>
