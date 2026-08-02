<script lang="ts">
	// The board's card viewer, pinned to the page's bottom-left: the full art of the card
	// last clicked on the canvas, with — when that card is one of the player's
	// own on-board creatures — a row of its Move / Combat buttons above it, the DOM twins
	// of the ones the creature unfolds on the board. The row also carries the close button
	// that drops the click selection and hands the board back to hover. Presentation only;
	// the parent passes the engine's previewCardSrc and previewUnitActions, and each action
	// carries its own run callback, so this component never decides what an action does or
	// when it's live.
	import classNames from 'classnames';
	import type { UnitAction } from '$types/board.type';

	let {
		src,
		actions = [],
		canClose = true,
		countdown = null,
		onclose
	}: {
		src: string;
		actions?: UnitAction[];
		canClose?: boolean;
		// The rival strike being held open on this card's creature, while the player answers
		// it with Defend: the milliseconds left against the window's full span. Null the rest
		// of the time, when no bar is drawn.
		countdown?: { msLeft: number; totalMs: number } | null;
		onclose: () => void;
	} = $props();

	const variantClasses: Record<UnitAction['variant'], string> = {
		primary: 'btn-primary',
		error: 'btn-error'
	};
</script>

<!-- pointer-events-none on the frame and the art so the viewer never intercepts board
     interaction; only the button row takes the pointer back. -->
<div class="pointer-events-none fixed bottom-4 left-4 z-20 flex w-[300px] flex-col gap-2">
	<!-- The countdown on a held rival strike: it drains over the window the player has to
	     press Defend, straight above that button. -->
	{#if countdown}
		<progress
			class="progress progress-warning pointer-events-auto h-2 w-full"
			value={countdown.msLeft}
			max={countdown.totalMs}
			aria-label="Time left to defend"
		></progress>
	{/if}

	<!-- The button row above the art: the clicked unit's actions, when it has any, and the
	     close button that unpins the card. -->
	<div class="pointer-events-auto flex items-start gap-2">
		{#if actions.length}
			<!-- Two columns for the Move / Combat pair; the single Cancel that replaces them
			     while an action is in flight spans the row. -->
			<div class="grid flex-1 grid-cols-2 gap-2">
				{#each actions as action (action.key)}
					<button
						type="button"
						class={classNames(
							'btn btn-sm gap-1 px-2 text-xs shadow-lg',
							variantClasses[action.variant],
							{ 'col-span-2': actions.length === 1 }
						)}
						disabled={!action.enabled}
						onclick={action.run}
					>
						<span>{action.label}</span>
						{#if action.role}
							<!-- (cost, effect): what the click spends, then what this creature does
							     with it — each behind the same icon the energy counters and the card
							     print it under, so the price and the payoff read before clicking. -->
							<span class="flex items-center gap-0.5">
								<span aria-hidden="true">(</span>
								{#if action.iconSrc}
									<img src={action.iconSrc} alt="" class="h-3.5 w-3.5" />
								{/if}
								<span class="font-bold">{action.cost}</span>
								{#if action.effect}
									<img
										src={action.effect.iconSrc}
										alt={action.effect.label}
										class="ml-1 h-3.5 w-3.5"
									/>
									<span class="font-bold">{action.effect.value}</span>
								{/if}
								<span aria-hidden="true">)</span>
							</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Close: drops the clicked card so the board answers to hover again. ml-auto keeps
		     it against the card's right edge when the row carries no action buttons. -->
		<button
			type="button"
			class="btn btn-circle btn-neutral btn-sm ml-auto shadow-lg"
			aria-label="Close card detail"
			title="Close"
			disabled={!canClose}
			onclick={onclose}
		>
			✕
		</button>
	</div>

	<img {src} alt="Selected card" class="w-full rounded-xl shadow-2xl" />
</div>
