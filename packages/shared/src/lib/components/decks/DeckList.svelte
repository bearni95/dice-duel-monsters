<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';
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
</script>

{#if error}
	<div class="alert alert-error text-sm" role="alert">{error}</div>
{/if}

{#if decks.length > 0}
	<ul class="space-y-2">
		{#each decks as deck (deck.id)}
			<!-- Rows are frosted glass rather than solid panels: whatever sits behind
			     the list still reads through them, blurred back enough that the text on
			     top stays legible. The active one is tinted the same way. -->
			<li
				class={classNames(
					'flex items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur-md',
					{
						'bg-primary/20 border-primary': playerDeckAdapter.isEnabled(deck, decks),
						'bg-base-100/50 border-base-300': !playerDeckAdapter.isEnabled(deck, decks)
					}
				)}
			>
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
