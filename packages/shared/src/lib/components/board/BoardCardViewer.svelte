<script lang="ts">
	// The board's card viewer, pinned to the page's bottom-left: the full art of the card
	// the pointer last hovered on the canvas, with — when that card is one of the player's
	// own on-board creatures — a row of its Move / Combat buttons above it, the DOM twins
	// of the ones the creature unfolds on the board. Presentation only; the parent passes
	// the engine's previewCardSrc and previewUnitActions, and each action carries its own
	// run callback, so this component never decides what an action does or when it's live.
	import classNames from 'classnames';
	import type { UnitAction } from '$types/board.type';

	let { src, actions = [] }: { src: string; actions?: UnitAction[] } = $props();

	const variantClasses: Record<UnitAction['variant'], string> = {
		primary: 'btn-primary',
		error: 'btn-error'
	};
</script>

<!-- pointer-events-none on the frame and the art so the viewer never intercepts board
     interaction; only the button row takes the pointer back. -->
<div class="pointer-events-none fixed bottom-4 left-4 z-20 flex w-[300px] flex-col gap-2">
	{#if actions.length}
		<!-- Two columns for the Move / Combat pair; the single Cancel that replaces them
		     while an action is in flight spans the row. -->
		<div class="pointer-events-auto grid grid-cols-2 gap-2">
			{#each actions as action (action.key)}
				<button
					type="button"
					class={classNames('btn btn-sm gap-1 shadow-lg', variantClasses[action.variant], {
						'col-span-2': actions.length === 1
					})}
					disabled={!action.enabled}
					onclick={action.run}
				>
					<span>{action.label}</span>
					{#if action.role}
						{#if action.iconSrc}
							<img src={action.iconSrc} alt="" class="h-4 w-4" />
						{/if}
						<span class="font-bold">{action.cost}</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	<img {src} alt="Hovered card" class="w-full rounded-xl shadow-2xl" />
</div>
