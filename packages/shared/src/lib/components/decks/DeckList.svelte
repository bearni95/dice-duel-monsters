<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// Every deck the player has saved.
	export let decks: PlayerDeck[] = [];
	// Card art by id, so each deck can show a preview strip of its contents.
	export let assets: Map<number, CardAsset> = new Map();
	// Blocks the controls while a save or delete is in flight.
	export let disabled: boolean = false;

	const dispatch = createEventDispatcher<{
		edit: { deck: PlayerDeck };
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

	// How many cards of a deck to show in its preview strip before trailing off.
	const PREVIEW_LIMIT = 8;

	// The first few distinct cards of a deck, resolved to art. Cards missing from
	// the collection are skipped rather than rendering a placeholder.
	function preview(deck: PlayerDeck): CardAsset[] {
		return deck.cards
			.map((entry) => assets.get(entry.cardId))
			.filter((card): card is CardAsset => Boolean(card))
			.slice(0, PREVIEW_LIMIT);
	}
</script>

<div class="space-y-3">
	{#each decks as deck (deck.id)}
		{@const total = playerDeckAdapter.totalCards(deck.cards)}
		<article class="card bg-base-200">
			<div class="card-body gap-3 p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="min-w-0">
						<h3 class="flex items-center gap-2 truncate text-lg font-bold">
							<!-- Decks are saved as they are built, so one can sit here unnamed
							     and half-full; both say so rather than reading as broken. -->
							{deck.name || 'Untitled deck'}
							{#if active?.id === deck.id}
								<span class="badge badge-primary badge-sm font-normal">On the board</span>
							{/if}
							{#if total !== DECK_SIZE}
								<span class="badge badge-ghost badge-sm font-normal">Unfinished</span>
							{/if}
						</h3>
						<p class="text-base-content/60 text-sm">
							{total}/{DECK_SIZE} cards · {deck.cards.length}
							{deck.cards.length === 1 ? 'unique card' : 'unique cards'}
						</p>
					</div>
					<div class="flex items-center gap-2">
						<label class="label cursor-pointer gap-2 py-0">
							<span class="label-text text-sm">Enabled</span>
							<input
								type="checkbox"
								class="toggle toggle-primary toggle-sm"
								checked={playerDeckAdapter.isEnabled(deck, decks)}
								disabled={disabled || onlyDeck}
								title={onlyDeck ? 'Your only deck is always the one you play with.' : undefined}
								on:change={(event) =>
									dispatch('enable', { deck, enabled: event.currentTarget.checked })}
							/>
						</label>
						<button
							class="btn btn-sm"
							{disabled}
							on:click={() => dispatch('edit', { deck })}
						>
							Edit
						</button>
						<button
							class="btn btn-ghost btn-sm text-error"
							{disabled}
							on:click={() => dispatch('remove', { deck })}
						>
							Delete
						</button>
					</div>
				</div>

				{#if deck.cards.length > 0}
					<div class="flex gap-1 overflow-x-auto">
						{#each preview(deck) as card (card.id)}
							<div class="w-14 shrink-0">
								<GeneratedCardImage id={card.id} name={card.name} />
							</div>
						{/each}
						{#if deck.cards.length > PREVIEW_LIMIT}
							<span class="text-base-content/50 self-center px-2 text-sm">
								+{deck.cards.length - PREVIEW_LIMIT} more
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</article>
	{/each}
</div>
