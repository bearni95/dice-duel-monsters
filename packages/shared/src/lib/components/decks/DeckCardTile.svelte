<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';

	// The card being shown. Rendered from its baked PNG, the same way the
	// collection grid on the home page renders owned cards.
	export let card: CardAsset;
	// Copies of this card in the deck being edited.
	export let inDeck: number = 0;
	// Copies of this card the player owns.
	export let owned: number = 0;
	// The most copies this deck may run of it (the 3-copy cap, capped again by
	// `owned`). Shown alongside the current count so the limit is visible.
	export let max: number = 0;
	// Set while the deck is already at its card limit, so adding is refused for a
	// reason that has nothing to do with this card.
	export let deckFull: boolean = false;
	// Blocks both controls while a save is in flight.
	export let disabled: boolean = false;
	// What the tile is for. `row` is a card in the collection: art that adds a copy
	// when clicked, with the count and both buttons on a line under it. `remove` is
	// one copy already in the deck — the copies of a card are shown one by one, so
	// there is no count to render, only the button that takes this copy back out.
	export let controls: 'row' | 'remove' = 'row';
	export let classes: string = '';

	const dispatch = createEventDispatcher<{ add: void; remove: void }>();

	$: canAdd = !disabled && !deckFull && inDeck < max;
	$: canRemove = controls === 'remove' ? !disabled : !disabled && inDeck > 0;

	// Why adding is refused, so both the art and the add button say the same thing.
	$: addTitle = canAdd
		? `Add ${card.name}`
		: deckFull
			? 'The deck is already full'
			: `You can run at most ${max} of ${card.name}`;

	// Dim collection cards that can't go into the deck at all (owned, but already
	// maxed out or the deck is full) so the addable ones stand out. A copy already
	// in the deck is never dimmed — it is there.
	$: tileClasses = classNames(
		'relative rounded transition-opacity',
		{ 'opacity-50': controls === 'row' && !canAdd && inDeck === 0 },
		classes
	);

	// The count reads as a live figure once the card is in the deck, and as the
	// limit it could reach while it isn't.
	$: countClasses = classNames('font-mono text-xs font-semibold', {
		'text-primary': inDeck > 0,
		'text-base-content/50': inDeck === 0
	});
</script>

<div class={tileClasses}>
	{#if controls === 'row'}
		<!-- The art doubles as the add button: clicking a card puts a copy in the
		     deck, which is the action wanted almost every time. -->
		<button
			type="button"
			class="block w-full cursor-pointer disabled:cursor-not-allowed"
			disabled={!canAdd}
			aria-label={`Add ${card.name} to the deck`}
			title={addTitle}
			on:click={() => dispatch('add')}
		>
			<GeneratedCardImage id={card.id} name={card.name} />
		</button>

		<!-- The count and both buttons on a line of their own under the art, so
		     nothing sits on top of the card being looked at. -->
		<div class="mt-1 flex items-center justify-between gap-1">
			<button
				type="button"
				class="btn btn-square btn-xs"
				disabled={!canRemove}
				aria-label={`Remove a copy of ${card.name} from the deck`}
				title={`Remove a copy of ${card.name}`}
				on:click={() => dispatch('remove')}
			>
				−
			</button>
			<span class={countClasses} title={`You own ${owned}`}>{inDeck}/{max}</span>
			<button
				type="button"
				class="btn btn-square btn-xs btn-primary"
				disabled={!canAdd}
				aria-label={`Add a copy of ${card.name} to the deck`}
				title={addTitle}
				on:click={() => dispatch('add')}
			>
				+
			</button>
		</div>
	{:else}
		<GeneratedCardImage id={card.id} name={card.name} />

		<button
			type="button"
			class="btn btn-error btn-xs mt-1 w-full"
			disabled={!canRemove}
			aria-label={`Remove a copy of ${card.name} from the deck`}
			title={`Remove a copy of ${card.name}`}
			on:click={() => dispatch('remove')}
		>
			−
		</button>
	{/if}
</div>
