<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// Every deck the player has saved, as the options to pick from.
	export let decks: PlayerDeck[] = [];
	// The deck currently open in the builder.
	export let selectedId: string | null = null;
	// Blocks the picker while a save or delete is in flight.
	export let disabled: boolean = false;

	const dispatch = createEventDispatcher<{ select: { deck: PlayerDeck } }>();

	// The deck the board deals from, called out in its option so the one that gets
	// played is visible without opening it.
	$: active = playerDeckAdapter.activeDeck(decks);

	// Mirrors the selection so the element stays in step with the deck the parent
	// has open — which isn't always the one that was picked here: a delete moves it
	// on, and a newly created deck opens itself.
	let currentId = '';
	$: currentId = selectedId ?? '';

	// Decks are saved as they are built, so one can sit here unnamed and half-full;
	// the option says so rather than reading as broken.
	function label(deck: PlayerDeck): string {
		const total = playerDeckAdapter.totalCards(deck.cards);
		const name = deck.name || 'Untitled deck';
		const suffix = active?.id === deck.id ? ' · on the board' : '';
		return `${name} · ${total}/${DECK_SIZE}${suffix}`;
	}

	function onChange(event: Event & { currentTarget: HTMLSelectElement }) {
		const deck = decks.find((candidate) => candidate.id === event.currentTarget.value);
		if (deck) dispatch('select', { deck });
	}
</script>

<select
	class="select select-bordered select-sm min-w-56"
	bind:value={currentId}
	{disabled}
	aria-label="Deck to edit"
	on:change={onChange}
>
	{#each decks as deck (deck.id)}
		<option value={deck.id}>{label(deck)}</option>
	{/each}
</select>
