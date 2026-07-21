<script lang="ts">
	// The board's right column: the turn/energy read-out, the on-board detail cell and
	// the drawn hand tray, stacked in a real space-occupying flex column beside the
	// canvas (never an overlay). Pure composition — it forwards the board engine to each
	// panel, which reads its state and dispatches its commands.
	import classNames from 'classnames';
	import DiceRoller from '$components/dice/DiceRoller.svelte';
	import InspectPanel from '$components/board/InspectPanel.svelte';
	import HandPanel from '$components/board/HandPanel.svelte';
	import type { BoardEngine } from '$services/board-engine.svelte';

	let { engine, collapsed = false }: { engine: BoardEngine; collapsed?: boolean } = $props();
</script>

<!-- When collapsed the column shrinks to zero width (its content clipped) so the canvas
     flex item takes over the whole row; otherwise it holds its fixed --right-col-w. -->
<aside
	class={classNames(
		'flex h-full shrink-0 grow-0 flex-col gap-2',
		collapsed ? 'w-0 overflow-hidden p-0' : 'w-[var(--right-col-w)] overflow-y-auto p-2'
	)}
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
