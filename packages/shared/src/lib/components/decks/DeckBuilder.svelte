<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher, onDestroy } from 'svelte';
	import DeckCardTile from '$components/decks/DeckCardTile.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// The deck being edited. It always exists — creating a deck saves it before
	// the builder opens — so this renders the stored deck rather than a draft of
	// one, and every edit below is dispatched to be persisted as it is made.
	export let deck: PlayerDeck;
	// The player's collection: every distinct card they own with its copy count.
	// This is both the pool to build from and the source of each card's cap.
	export let collection: { card: CardAsset; count: number }[] = [];
	// Set while a write is in flight, shown as the save status.
	export let saving: boolean = false;
	// A message from a failed write, shown in place of the status.
	export let error: string = '';

	const dispatch = createEventDispatcher<{
		rename: { name: string };
		add: { cardId: number };
		remove: { cardId: number };
		done: void;
	}>();

	// How long typing pauses before a rename is dispatched. Long enough that a
	// name is written once rather than per keystroke, short enough that a player
	// who types and immediately navigates away doesn't outrun it (and `onDestroy`
	// covers them if they do).
	const RENAME_DEBOUNCE_MS = 500;

	// The name field is the one edit that isn't applied on the spot: it mirrors
	// the deck locally while typing, so the caret isn't disturbed by the store
	// updating underneath it.
	let name = deck.name;
	let renamingDeckId = deck.id;
	let renameTimer: ReturnType<typeof setTimeout> | null = null;

	// Switching decks re-seeds the field; the deck's own name changing (from a
	// write landing, say) doesn't clobber what is being typed.
	$: if (renamingDeckId !== deck.id) {
		flushRename();
		name = deck.name;
		renamingDeckId = deck.id;
	}

	$: cards = deck.cards;

	// Copies owned per card id, which caps how many of it a deck may run.
	$: owned = new Map(collection.map(({ card, count }) => [card.id, count]));

	// Card art by id, so the deck contents can be rendered from the same assets
	// the collection grid uses.
	$: assets = new Map(collection.map(({ card }) => [card.id, card]));

	$: total = playerDeckAdapter.totalCards(cards);
	$: deckFull = total >= DECK_SIZE;

	// What still stands between this deck and being playable. It gates nothing —
	// the deck is saved either way — it just says what is left to do.
	$: problem = playerDeckAdapter.validate(name, cards, owned);

	// The deck's contents paired with their art, dropping any card that has fallen
	// out of the collection (nothing removes ownership today, but the deck should
	// still render rather than break if it ever does).
	$: deckTiles = cards
		.map((entry) => ({ entry, card: assets.get(entry.cardId) }))
		.filter((tile): tile is { entry: (typeof cards)[number]; card: CardAsset } => Boolean(tile.card));

	$: counterClasses = classNames('font-mono text-lg font-bold', {
		'text-success': total === DECK_SIZE,
		'text-base-content/60': total !== DECK_SIZE
	});

	function flushRename() {
		if (renameTimer === null) return;
		clearTimeout(renameTimer);
		renameTimer = null;
		dispatch('rename', { name: name.trim() });
	}

	function onNameInput() {
		if (renameTimer !== null) clearTimeout(renameTimer);
		renameTimer = setTimeout(() => {
			renameTimer = null;
			dispatch('rename', { name: name.trim() });
		}, RENAME_DEBOUNCE_MS);
	}

	// Leaving the page mid-rename still saves it.
	onDestroy(flushRename);
</script>

<section
	class="flex flex-col gap-6 lg:flex-row lg:items-start"
	aria-label="Edit deck"
>
	<!-- The deck itself — name, count and contents — as a side menu, so the
	     collection it is filled from stays visible the whole time it is edited. -->
	<aside
		class="bg-base-200 w-full shrink-0 space-y-4 rounded-lg p-4 lg:sticky lg:top-4 lg:w-80"
		aria-label="Deck"
	>
		<button class="btn btn-ghost btn-sm -ml-2" on:click={() => dispatch('done')}>
			← All decks
		</button>

		<label class="form-control">
			<span class="label-text mb-1">Deck name</span>
			<input
				class="input input-bordered w-full"
				type="text"
				placeholder="Name your deck"
				maxlength="40"
				bind:value={name}
				on:input={onNameInput}
				on:blur={flushRename}
			/>
		</label>

		<div class="flex items-center justify-between">
			<span class="label-text">Cards</span>
			<span class={counterClasses}>{total}/{DECK_SIZE}</span>
		</div>

		<!-- Where a save button used to be. Every edit is already written; this only
		     reports how that is going. -->
		{#if error}
			<div class="alert alert-error text-sm" role="alert">{error}</div>
		{:else}
			<p class="text-base-content/60 text-sm" aria-live="polite">
				{#if saving}
					Saving…
				{:else if problem}
					Saved · {problem}
				{:else}
					Saved · ready to play
				{/if}
			</p>
		{/if}

		<div class="space-y-2">
			<h3 class="font-semibold">In this deck</h3>
			{#if deckTiles.length > 0}
				<div class="grid max-h-[55vh] grid-cols-3 gap-2 overflow-y-auto">
					{#each deckTiles as { entry, card } (card.id)}
						<DeckCardTile
							{card}
							inDeck={entry.quantity}
							owned={owned.get(card.id) ?? 0}
							max={playerDeckAdapter.maxCopies(owned.get(card.id) ?? 0)}
							{deckFull}
							on:add={() => dispatch('add', { cardId: card.id })}
							on:remove={() => dispatch('remove', { cardId: card.id })}
						/>
					{/each}
				</div>
			{:else}
				<div
					class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm"
				>
					Empty. Pick cards from your collection.
				</div>
			{/if}
		</div>
	</aside>

	<div class="min-w-0 flex-1 space-y-2">
		<h3 class="font-semibold">Your collection</h3>
		<p class="text-base-content/60 text-sm">
			Click a card to add a copy. Up to 3 copies per deck, and never more than you own — your cards
			stay available to every other deck.
		</p>
		{#if collection.length > 0}
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
				{#each collection as { card, count } (card.id)}
					<DeckCardTile
						{card}
						inDeck={playerDeckAdapter.copiesOf(cards, card.id)}
						owned={count}
						max={playerDeckAdapter.maxCopies(count)}
						{deckFull}
						on:add={() => dispatch('add', { cardId: card.id })}
						on:remove={() => dispatch('remove', { cardId: card.id })}
					/>
				{/each}
			</div>
		{:else}
			<div
				class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm"
			>
				You don't own any cards yet. Grab some from the home page first.
			</div>
		{/if}
	</div>
</section>
