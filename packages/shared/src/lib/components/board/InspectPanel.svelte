<script lang="ts">
	// The on-board detail cell: the last-clicked creature's card and its actions, in a
	// two-column grid above the hand. Always visible — the card slot shows the inspected
	// creature or an empty placeholder, and the actions sit beside it (Move / Combat plus
	// the turn actions Unfold / End Turn), disabled until a player unit is inspected.
	//
	// UI only: every piece of state and every command is read from / dispatched to the
	// board engine, which owns the game logic. The engine is passed in as the view-model.
	import classNames from 'classnames';
	import GameCard from '$components/cards/GameCard.svelte';
	import type { BoardEngine } from '$services/board-engine.svelte';

	let { engine }: { engine: BoardEngine } = $props();
</script>

<div class="grid grid-cols-2 items-start gap-2">
	<!-- Card slot: the preview creature (the inspected unit, or the first hand card by
	     default so the slot always shows something), or an empty square placeholder
	     holding the layout so the grid never collapses to a full-width prompt. While no
	     creature is inspected the default hand-card preview is crushed to a flat black
	     silhouette (brightness to zero, contrast maxed); once a card is selected it
	     renders normally. -->
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

	<!-- Actions: the inspected unit's Move/Combat (or their in-progress Cancel), with
	     the turn actions pinned beneath them. -->
	<div class="flex h-full flex-col gap-2">
		{#if engine.inspectedCreature && engine.inspectedIsPlayer && engine.moving}
			<button class="btn btn-sm btn-error" onclick={engine.cancelMove}>Cancel Move</button>
		{:else if engine.inspectedCreature && engine.inspectedIsPlayer && engine.combating}
			<button class="btn btn-sm btn-error" onclick={engine.cancelCombat}>Cancel Combat</button>
		{:else}
			<!-- Rival creatures (and the rival's own turn) show the same buttons, all disabled.
			     Also disabled while a summon is landing, or with nothing inspected. -->
			{@const controlsDisabled =
				!engine.inspectedCreature ||
				!engine.inspectedIsPlayer ||
				engine.rivalThinking ||
				engine.summoning}
			<button
				class="btn btn-sm btn-primary justify-between"
				disabled={controlsDisabled ||
					!engine.inspectedCreature ||
					engine.energyPoints < engine.inspectedCreature.cost}
				onclick={engine.startMove}
			>
				<span>Move</span>
				<span class="text-xs opacity-80">
					{#if engine.inspectedCreature}
						Cost {engine.inspectedCreature.cost} · SPD {engine.inspectedCreature.speed}
					{:else}
						—
					{/if}
				</span>
			</button>
			<button
				class="btn btn-sm btn-primary justify-between"
				disabled={controlsDisabled ||
					!engine.inspectedCreature ||
					engine.energyPoints < engine.inspectedCreature.cost ||
					!engine.inspectedCanCombat}
				onclick={engine.startCombat}
			>
				<span>Combat</span>
				<span class="text-xs opacity-80">
					{#if engine.inspectedCreature}
						Cost {engine.inspectedCreature.cost} · ATK {engine.inspectedCreature.atk}d6
					{:else}
						—
					{/if}
				</span>
			</button>
		{/if}

		<!-- Turn actions: pinned to the bottom of the column, under the unit actions and
		     separated by a rule. Unfold extends the network for a fixed cost; End Turn
		     hands control to the rival. -->
		<div class="mt-auto flex flex-col gap-2 border-t border-base-300 pt-2">
			<button
				class={classNames('btn btn-sm w-full gap-1', engine.unfolding ? 'btn-secondary' : 'btn-outline')}
				onclick={engine.startUnfold}
				disabled={engine.rivalThinking ||
					engine.rolling ||
					(!engine.unfolding && engine.energyPoints < engine.UNFOLD_COST)}
			>
				{#if engine.unfolding}
					Cancel Unfold
				{:else}
					Unfold ({engine.UNFOLD_COST}
					<span
						class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
						aria-label="Energy"
						title="Energy"
					></span>)
				{/if}
			</button>
			<button
				class="btn btn-outline btn-sm w-full"
				onclick={engine.endTurn}
				disabled={!engine.energyRolled || engine.rolling || engine.rivalThinking}
			>
				{#if engine.rolling}
					<span class="loading loading-spinner loading-xs"></span>
					Rolling…
				{:else}
					End Turn
				{/if}
			</button>
		</div>
	</div>
</div>
