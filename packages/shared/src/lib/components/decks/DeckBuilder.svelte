<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher, onDestroy } from 'svelte';
	import DeckCardTile from '$components/decks/DeckCardTile.svelte';
	import DeckSelect from '$components/decks/DeckSelect.svelte';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// Every deck the player has, listed in the side menu. Picking one from there
	// opens it below, in the same menu — there is no separate step for choosing a
	// deck before the collection is on screen.
	export let decks: PlayerDeck[] = [];
	// The deck being edited, or `null` when the player has none yet. It is always a
	// stored deck — creating one saves it before it opens — so this renders the
	// stored deck rather than a draft of one, and every edit below is dispatched to
	// be persisted as it is made.
	export let deck: PlayerDeck | null = null;
	// The player's collection: every distinct card they own with its copy count.
	// This is both the pool to build from and the source of each card's cap.
	export let collection: { card: CardAsset; count: number }[] = [];
	// Set while a write is in flight, shown as the save status.
	export let saving: boolean = false;
	// A message from a failed write, shown in place of the status.
	export let error: string = '';

	const dispatch = createEventDispatcher<{
		create: void;
		select: { deck: PlayerDeck };
		enable: { deck: PlayerDeck; enabled: boolean };
		deleteDeck: { deck: PlayerDeck };
		rename: { deckId: string; name: string };
		add: { cardId: number };
		remove: { cardId: number };
	}>();

	// How long typing pauses before a rename is dispatched. Long enough that a
	// name is written once rather than per keystroke, short enough that a player
	// who types and immediately navigates away doesn't outrun it (and `onDestroy`
	// covers them if they do).
	const RENAME_DEBOUNCE_MS = 500;

	// The name field is the one edit that isn't applied on the spot: it mirrors
	// the deck locally while typing, so the caret isn't disturbed by the store
	// updating underneath it. The pending write carries the id of the deck it was
	// typed into, so switching decks mid-rename can't name the wrong one.
	let name = deck?.name ?? '';
	let renamingDeckId: string | null = deck?.id ?? null;
	let renameTimer: ReturnType<typeof setTimeout> | null = null;

	// Switching decks re-seeds the field; the deck's own name changing (from a
	// write landing, say) doesn't clobber what is being typed.
	$: if (renamingDeckId !== (deck?.id ?? null)) {
		flushRename();
		name = deck?.name ?? '';
		renamingDeckId = deck?.id ?? null;
	}

	$: cards = deck?.cards ?? [];

	// Card art by id, so the deck contents can be rendered from the same assets
	// the collection grid uses.
	$: assets = new Map(collection.map(({ card }) => [card.id, card]));

	$: total = playerDeckAdapter.totalCards(cards);
	$: deckFull = total >= DECK_SIZE;

	// With no deck open there is nothing for a card click to go into, so the
	// collection is shown but inert until one is created or picked.
	$: noDeck = deck === null;

	// The card under the pointer, from either grid, shown full size in the right
	// column. It is the last card hovered rather than the one hovered right now:
	// moving off a tile to click something else leaves the card up instead of
	// blanking the viewer.
	let hovered: CardAsset | null = null;

	// The collection with the open deck's copies taken out of it: a card whose every
	// owned copy is already in the deck leaves the grid entirely, so what is shown
	// is what is still there to be added. Copies come back the moment they are
	// removed from the deck, and with no deck open nothing is taken out.
	$: available = collection.filter(
		({ card, count }) => playerDeckAdapter.copiesOutsideDeck(cards, card.id, count) > 0
	);

	// Until a card has been pointed at, the viewer shows the first one in the grid
	// rather than an empty frame — the collection arrives after the first render, so
	// this waits for it and then leaves the viewer alone.
	$: if (hovered === null && (available.length > 0 || collection.length > 0)) {
		hovered = (available[0] ?? collection[0]).card;
	}

	// The deck's contents as one tile per copy rather than one per card with a count
	// on it — three copies of a card are three cards in the deck, and the grid says
	// so. Cards that have fallen out of the collection are dropped (nothing removes
	// ownership today, but the deck should still render rather than break if it
	// ever does).
	$: deckCopies = cards.flatMap((entry) => {
		const card = assets.get(entry.cardId);
		if (!card) return [];
		return Array.from({ length: entry.quantity }, (_, copy) => ({
			key: `${entry.cardId}-${copy}`,
			card
		}));
	});

	$: counterClasses = classNames('font-mono text-lg font-bold', {
		'text-success': total === DECK_SIZE,
		'text-base-content/60': total !== DECK_SIZE
	});

	function flushRename() {
		if (renameTimer === null) return;
		clearTimeout(renameTimer);
		renameTimer = null;
		if (renamingDeckId) dispatch('rename', { deckId: renamingDeckId, name: name.trim() });
	}

	function onNameInput() {
		if (renameTimer !== null) clearTimeout(renameTimer);
		const deckId = renamingDeckId;
		renameTimer = setTimeout(() => {
			renameTimer = null;
			if (deckId) dispatch('rename', { deckId, name: name.trim() });
		}, RENAME_DEBOUNCE_MS);
	}

	// Leaving the page mid-rename still saves it.
	onDestroy(flushRename);
</script>

<!-- The page as a three-column grid filling the viewport and no more: the
     collection takes two of the columns and the hovered card and deck being edited
     the third, each scrolling inside its own cell. The page's padding comes out of
     the height, so nothing here has to be scrolled to. Below `lg` the two stack,
     since neither survives being a third of a phone screen. -->
<section class="grid grid-cols-1 gap-6 lg:h-[calc(100dvh-4rem)] lg:grid-cols-3" aria-label="Decks">
	<div class="h-[60vh] min-w-0 overflow-y-auto pr-1 lg:col-span-2 lg:h-auto lg:min-h-0">
		{#if available.length > 0}
			<div class="grid grid-cols-6 gap-3">
				{#each available as { card, count } (card.id)}
					<DeckCardTile
						{card}
						inDeck={playerDeckAdapter.copiesOf(cards, card.id)}
						owned={count}
						max={playerDeckAdapter.maxCopies(count)}
						{deckFull}
						disabled={noDeck}
						controls="row"
						on:hover={() => (hovered = card)}
						on:add={() => dispatch('add', { cardId: card.id })}
						on:remove={() => dispatch('remove', { cardId: card.id })}
					/>
				{/each}
			</div>
		{:else}
			<div
				class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm"
			>
				{#if collection.length === 0}
					You don't own any cards yet. Grab some from the home page first.
				{:else}
					Every card you own is in this deck.
				{/if}
			</div>
		{/if}
	</div>

	<!-- The right column: the card being pointed at on top, the decks under it. -->
	<div class="flex min-w-0 flex-col gap-4 lg:col-span-1 lg:min-h-0">
		<!-- The hovered card in the first of two columns, and beside it the controls
		     for which deck is being built: the picker, whether it is the deck played,
		     its name, and the button that starts another. The viewer holds a card's
		     shape whether or not one has been hovered yet, so nothing below it jumps
		     the first time a card lands here. -->
		<div class="grid shrink-0 grid-cols-2 gap-4">
			<div class="min-w-0">
				{#if hovered}
					<GeneratedCardImage id={hovered.id} name={hovered.name} />
				{:else}
					<div
						class="border-base-300 text-base-content/60 flex aspect-[1080/1415] w-full items-center justify-center rounded-lg border border-dashed p-2 text-center text-xs"
					>
						Point at a card to see it here.
					</div>
				{/if}
			</div>

			<div class="flex min-w-0 flex-col gap-2">
				<!-- Picking a deck and starting one are the same decision, so they share a
				     row; the button is a plus rather than a label to leave the picker the
				     width it needs. -->
				<div class="flex min-w-0 items-center gap-2">
					{#if decks.length > 0}
						<DeckSelect {decks} selectedId={deck?.id ?? null} disabled={saving} on:select />
					{/if}
					<button
						class="btn btn-primary btn-square btn-sm shrink-0"
						disabled={collection.length === 0 || saving}
						aria-label="New deck"
						title="Start a new deck"
						on:click={() => dispatch('create')}
					>
						+
					</button>
				</div>

				{#if deck}
					<!-- One deck is active at a time: switching this on stands down whichever
					     deck held it. A player's only deck is played whether or not its flag
					     was ever set, so its switch reads on and can't be turned off. -->
					<label class="label cursor-pointer justify-start gap-2">
						<span class="label-text">Active</span>
						<input
							type="checkbox"
							class="toggle toggle-primary toggle-sm"
							checked={playerDeckAdapter.isEnabled(deck, decks)}
							disabled={saving || decks.length === 1}
							title={decks.length === 1
								? 'Your only deck is always the one you play with.'
								: 'Make this the deck you take to the board'}
							on:change={(event) =>
								deck && dispatch('enable', { deck, enabled: event.currentTarget.checked })}
						/>
					</label>

					<input
						class="input input-bordered input-sm w-full"
						type="text"
						placeholder="Name your deck"
						maxlength="40"
						aria-label="Deck name"
						bind:value={name}
						on:input={onNameInput}
						on:blur={flushRename}
					/>

					<!-- How full the open deck is, and the way to be rid of it, at the foot
					     of the column so the destructive button is nowhere near the ones
					     used while building. -->
					<div class="mt-auto flex items-center justify-between gap-2">
						<span class="label-text">Cards</span>
						<span class={counterClasses}>{total}/{DECK_SIZE}</span>
					</div>

					<button
						class="btn btn-ghost btn-sm text-error"
						disabled={saving}
						on:click={() => deck && dispatch('deleteDeck', { deck })}
					>
						Delete
					</button>
				{/if}
			</div>
		</div>

		<!-- The decks: which one is open is a picker rather than a list, so the panel
		     is only ever showing the deck being worked on. -->
		<aside
			class="bg-base-200 w-full space-y-4 rounded-lg p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
			aria-label="Your decks"
		>
			{#if error}
				<div class="alert alert-error text-sm" role="alert">{error}</div>
			{/if}

			{#if decks.length === 0}
				<p class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-4 text-sm">
					{#if collection.length === 0}
						You need cards before you can build a deck. Grab some on the home page first.
					{:else}
						No decks yet. Start one, then click cards from your collection to fill it.
					{/if}
				</p>
			{/if}

			{#if deck}
				{#if deckCopies.length > 0}
					<div class="grid grid-cols-6 gap-2">
						{#each deckCopies as { key, card } (key)}
							<DeckCardTile
								{card}
								controls="remove"
								on:hover={() => (hovered = card)}
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
			{/if}
		</aside>
	</div>
</section>
