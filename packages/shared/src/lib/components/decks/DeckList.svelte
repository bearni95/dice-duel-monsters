<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import type { PlayerDeck } from '$types/player-deck.type';

	// Every deck the player has saved, one row each.
	export let decks: PlayerDeck[] = [];
	// Blocks the toggles while a write is in flight.
	export let saving: boolean = false;
	// A message from a failed write, shown above the list.
	export let error: string = '';

	const dispatch = createEventDispatcher<{ enable: { deck: PlayerDeck; enabled: boolean } }>();

	// Decks are saved as they are built, so one can sit here unnamed and half-full;
	// the row says so rather than reading as broken.
	function label(deck: PlayerDeck): string {
		return deck.name || 'Untitled deck';
	}

	// The card standing in for the deck on its row: the first one put into it. A
	// deck that is still empty has none, and its row closes up around the name.
	function coverCardId(deck: PlayerDeck): number | null {
		return deck.cards[0]?.cardId ?? null;
	}
</script>

{#if error}
	<div class="alert alert-error text-sm" role="alert">{error}</div>
{/if}

{#if decks.length > 0}
	<ul class="space-y-2">
		{#each decks as deck (deck.id)}
			{@const cover = coverCardId(deck)}
			<!-- Rows are frosted glass rather than solid panels: whatever sits behind
			     the list still reads through them, blurred back enough that the text on
			     top stays legible. The active one is tinted the same way. The deck's
			     first card is the row's full height and flush with its edges, so the row
			     is sized for it and clips it back to the same rounded corners. -->
			<li
				class={classNames(
					'flex h-20 items-center gap-3 overflow-hidden rounded-lg border pr-3 backdrop-blur-md',
					{
						'bg-primary/20 border-primary': playerDeckAdapter.isEnabled(deck, decks),
						'bg-base-100/50 border-base-300': !playerDeckAdapter.isEnabled(deck, decks),
						'pl-3': cover === null
					}
				)}
			>
				{#if cover !== null}
					<GeneratedCardImage id={cover} classes="h-full w-auto shrink-0" />
				{/if}

				<p class="min-w-0 flex-1 truncate font-medium">{label(deck)}</p>

				<!-- One deck is active at a time: switching this on stands down whichever
				     deck held it. A player's only deck is played whether or not its flag
				     was ever set, so its switch reads on and can't be turned off. The
				     switch carries no visible label — it names itself to assistive tech,
				     and the row it sits on is the deck it acts on. -->
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm shrink-0"
					checked={playerDeckAdapter.isEnabled(deck, decks)}
					disabled={saving || decks.length === 1}
					aria-label={`Play with ${label(deck)}`}
					title={decks.length === 1
						? 'Your only deck is always the one you play with.'
						: 'Make this the deck you take to the board'}
					on:change={(event) => dispatch('enable', { deck, enabled: event.currentTarget.checked })}
				/>
			</li>
		{/each}
	</ul>
{:else}
	<p
		class="border-base-300 bg-base-100/50 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm backdrop-blur-md"
	>
		You don't have any decks yet. Build one on the decks page.
	</p>
{/if}
