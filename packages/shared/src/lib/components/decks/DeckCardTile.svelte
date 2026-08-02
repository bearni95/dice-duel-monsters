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
	export let classes: string = '';

	const dispatch = createEventDispatcher<{ add: void; remove: void }>();

	$: canAdd = !disabled && !deckFull && inDeck < max;
	$: canRemove = !disabled && inDeck > 0;

	// Dim cards that can't go into the deck at all (owned, but already maxed out
	// or the deck is full) so the addable ones stand out.
	$: tileClasses = classNames(
		'relative rounded transition-opacity',
		{ 'opacity-50': !canAdd && inDeck === 0 },
		classes
	);
</script>

<div class={tileClasses}>
	<!-- The art doubles as the add button: clicking a card puts a copy in the deck,
	     which is the action wanted almost every time. -->
	<button
		type="button"
		class="block w-full cursor-pointer disabled:cursor-not-allowed"
		disabled={!canAdd}
		aria-label={`Add ${card.name} to the deck`}
		title={canAdd
			? `Add ${card.name}`
			: deckFull
				? 'The deck is already full'
				: `You can run at most ${max} of ${card.name}`}
		on:click={() => dispatch('add')}
	>
		<GeneratedCardImage id={card.id} name={card.name} />
	</button>

	{#if inDeck > 0}
		<span class="badge badge-primary badge-sm absolute top-1 right-1 font-semibold">
			{inDeck}/{max}
		</span>
	{:else if owned > 1}
		<span class="badge badge-neutral badge-sm absolute top-1 right-1 font-semibold">
			×{owned}
		</span>
	{/if}

	{#if inDeck > 0}
		<button
			type="button"
			class="btn btn-error btn-xs absolute bottom-1 left-1"
			disabled={!canRemove}
			aria-label={`Remove a copy of ${card.name} from the deck`}
			title={`Remove a copy of ${card.name}`}
			on:click={() => dispatch('remove')}
		>
			−
		</button>
	{/if}
</div>
