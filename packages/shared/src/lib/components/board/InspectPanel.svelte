<script lang="ts">
	// The on-board detail cell: the last-clicked creature's card, above the hand. The
	// card slot shows the inspected creature or, by default, a silhouette of the first
	// hand card. The unit/turn action buttons (Move / Combat / Unfold / End Turn) no
	// longer live here — they're rendered on the game canvas, in a column under the
	// player's red energy dice (see renderActionButtons in the board engine).
	//
	// UI only: every piece of state is read from the board engine, passed in as the
	// view-model.
	import classNames from 'classnames';
	import GameCard from '$components/cards/GameCard.svelte';
	import type { BoardEngine } from '$services/board-engine.svelte';

	let { engine }: { engine: BoardEngine } = $props();
</script>

<!-- Card slot: the preview creature (the inspected unit, or the first hand card by
     default so the slot always shows something), or an empty square placeholder holding
     the layout so the cell never collapses. While no creature is inspected the default
     hand-card preview is crushed to a flat black silhouette (brightness to zero, contrast
     maxed); once a card is selected it renders normally. Kept to half the column width so
     the preview stays the size it was beside the (now canvas-side) action buttons. -->
<div class="w-1/2">
	{#if engine.previewCreature}
		<div
			class={classNames('pointer-events-none', {
				'brightness-0 contrast-200': !engine.inspectedCreature
			})}
		>
			<GameCard card={engine.previewCreature} />
		</div>
	{:else}
		<div
			class="flex aspect-square w-full items-center justify-center rounded border border-dashed border-base-300 bg-base-100/60 p-3 text-center text-xs text-base-content/50"
		>
			Click a creature to inspect it.
		</div>
	{/if}
</div>
