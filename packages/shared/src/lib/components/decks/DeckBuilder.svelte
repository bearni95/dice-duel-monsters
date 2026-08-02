<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';
	import DeckCardTile from '$components/decks/DeckCardTile.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck, type PlayerDeckCard } from '$types/player-deck.type';

	// The deck being edited, or `null` when building a new one.
	export let deck: PlayerDeck | null = null;
	// The player's collection: every distinct card they own with its copy count.
	// This is both the pool to build from and the source of each card's cap.
	export let collection: { card: CardAsset; count: number }[] = [];
	// Set while a save is in flight, so the whole editor goes read-only.
	export let saving: boolean = false;
	// A message from a failed save, shown alongside the local validation hint.
	export let error: string = '';

	const dispatch = createEventDispatcher<{
		save: { name: string; cards: PlayerDeckCard[] };
		cancel: void;
	}>();

	// The draft. Seeded from `deck` below; editing only ever touches these, and
	// nothing reaches Supabase until `save` is dispatched and the page acts on it.
	let name = '';
	let cards: PlayerDeckCard[] = [];

	// Which deck the draft was seeded from, so switching decks re-seeds while
	// ordinary edits don't get clobbered on every re-render. `null` (a new deck)
	// is tracked as the distinct sentinel `'new'`.
	let seededFor: string | null = null;

	$: {
		const key = deck?.id ?? 'new';
		if (seededFor !== key) {
			name = deck?.name ?? '';
			cards = deck ? deck.cards.map((card) => ({ ...card })) : [];
			seededFor = key;
		}
	}

	// Copies owned per card id, which caps how many of it a deck may run.
	$: owned = new Map(collection.map(({ card, count }) => [card.id, count]));

	// Card art by id, so the deck contents can be rendered from the same assets
	// the collection grid uses.
	$: assets = new Map(collection.map(({ card }) => [card.id, card]));

	$: total = playerDeckAdapter.totalCards(cards);
	$: deckFull = total >= DECK_SIZE;
	$: problem = playerDeckAdapter.validate(name, cards, owned);
	$: canSave = !saving && problem === null;

	// The deck's contents paired with their art, dropping any card that has fallen
	// out of the collection (nothing removes ownership today, but the deck should
	// still render rather than break if it ever does).
	$: deckTiles = cards
		.map((entry) => ({ entry, card: assets.get(entry.cardId) }))
		.filter((tile): tile is { entry: PlayerDeckCard; card: CardAsset } => Boolean(tile.card));

	$: counterClasses = classNames('font-mono text-lg font-bold', {
		'text-success': total === DECK_SIZE,
		'text-error': total > DECK_SIZE,
		'text-base-content/60': total < DECK_SIZE
	});

	function add(cardId: number) {
		cards = playerDeckAdapter.addCopy(cards, cardId, owned.get(cardId) ?? 0);
	}

	function remove(cardId: number) {
		cards = playerDeckAdapter.removeCopy(cards, cardId);
	}

	function save() {
		if (!canSave) return;
		dispatch('save', { name: name.trim(), cards });
	}
</script>

<section class="space-y-5" aria-label={deck ? 'Edit deck' : 'New deck'}>
	<div class="flex flex-wrap items-end justify-between gap-3">
		<label class="form-control min-w-0 flex-1">
			<span class="label-text mb-1">Deck name</span>
			<input
				class="input input-bordered w-full"
				type="text"
				placeholder="Name your deck"
				maxlength="40"
				disabled={saving}
				bind:value={name}
			/>
		</label>

		<div class="text-right">
			<span class="label-text block">Cards</span>
			<span class={counterClasses}>{total}/{DECK_SIZE}</span>
		</div>

		<div class="flex gap-2">
			<button class="btn btn-ghost" disabled={saving} on:click={() => dispatch('cancel')}>
				Cancel
			</button>
			<button class="btn btn-primary" disabled={!canSave} on:click={save}>
				{saving ? 'Saving…' : 'Save deck'}
			</button>
		</div>
	</div>

	{#if error}
		<div class="alert alert-error text-sm" role="alert">{error}</div>
	{:else if problem}
		<p class="text-base-content/60 text-sm">{problem}</p>
	{/if}

	<div class="space-y-2">
		<h3 class="font-semibold">In this deck</h3>
		{#if deckTiles.length > 0}
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
				{#each deckTiles as { entry, card } (card.id)}
					<DeckCardTile
						{card}
						inDeck={entry.quantity}
						owned={owned.get(card.id) ?? 0}
						max={playerDeckAdapter.maxCopies(owned.get(card.id) ?? 0)}
						{deckFull}
						disabled={saving}
						on:add={() => add(card.id)}
						on:remove={() => remove(card.id)}
					/>
				{/each}
			</div>
		{:else}
			<div
				class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm"
			>
				Empty. Pick cards from your collection below.
			</div>
		{/if}
	</div>

	<div class="space-y-2">
		<h3 class="font-semibold">Your collection</h3>
		<p class="text-base-content/60 text-sm">
			Click a card to add a copy. Up to 3 copies per deck, and never more than you own — your
			cards stay available to every other deck.
		</p>
		{#if collection.length > 0}
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
				{#each collection as { card, count } (card.id)}
					<DeckCardTile
						{card}
						inDeck={playerDeckAdapter.copiesOf(cards, card.id)}
						owned={count}
						max={playerDeckAdapter.maxCopies(count)}
						{deckFull}
						disabled={saving}
						on:add={() => add(card.id)}
						on:remove={() => remove(card.id)}
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
