<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// Every deck the player has saved.
	export let decks: PlayerDeck[] = [];
	// The deck currently open in the builder, highlighted here so the list and the
	// editor below it read as one thing.
	export let selectedId: string | null = null;
	// Blocks the controls while a save or delete is in flight.
	export let disabled: boolean = false;

	const dispatch = createEventDispatcher<{
		select: { deck: PlayerDeck };
		remove: { deck: PlayerDeck };
		enable: { deck: PlayerDeck; enabled: boolean };
	}>();

	// The deck the board deals from. Several decks may be enabled at once, so this
	// is named on the one that actually gets played rather than left to be guessed
	// from the switches.
	$: active = playerDeckAdapter.activeDeck(decks);

	// A player's only deck is played whether or not its flag was ever set, so its
	// switch reads on and can't be turned off — there is nothing to fall back to.
	$: onlyDeck = decks.length === 1;

	// The list lives in a narrow sidebar, so a deck is a row rather than a card:
	// its name, how full it is, and the two controls that don't need the builder.
	function rowClasses(selected: boolean): string {
		return classNames('flex items-center gap-1 rounded-lg border p-2 transition-colors', {
			'border-primary bg-base-100': selected,
			'border-transparent hover:bg-base-100/60': !selected
		});
	}
</script>

<ul class="space-y-1">
	{#each decks as deck (deck.id)}
		{@const total = playerDeckAdapter.totalCards(deck.cards)}
		{@const selected = deck.id === selectedId}
		<li class={rowClasses(selected)}>
			<button
				type="button"
				class="min-w-0 flex-1 cursor-pointer text-left"
				aria-current={selected ? 'true' : undefined}
				on:click={() => dispatch('select', { deck })}
			>
				<span class="flex items-center gap-1.5">
					<!-- Decks are saved as they are built, so one can sit here unnamed
					     and half-full; both say so rather than reading as broken. -->
					<span class="truncate font-semibold">{deck.name || 'Untitled deck'}</span>
					{#if active?.id === deck.id}
						<span class="badge badge-primary badge-xs shrink-0 font-normal">On the board</span>
					{/if}
				</span>
				<span class="text-base-content/60 block text-xs">
					{total}/{DECK_SIZE} cards{total !== DECK_SIZE ? ' · unfinished' : ''}
				</span>
			</button>

			<input
				type="checkbox"
				class="toggle toggle-primary toggle-xs"
				checked={playerDeckAdapter.isEnabled(deck, decks)}
				disabled={disabled || onlyDeck}
				aria-label={`Play with ${deck.name || 'this untitled deck'}`}
				title={onlyDeck
					? 'Your only deck is always the one you play with.'
					: 'Take this deck to the board'}
				on:change={(event) => dispatch('enable', { deck, enabled: event.currentTarget.checked })}
			/>
			<button
				type="button"
				class="btn btn-ghost btn-xs text-error"
				{disabled}
				aria-label={`Delete ${deck.name || 'this untitled deck'}`}
				title="Delete this deck"
				on:click={() => dispatch('remove', { deck })}
			>
				✕
			</button>
		</li>
	{/each}
</ul>
