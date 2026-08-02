<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { playerDeckService } from '$services/player-deck.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import DeckBuilder from '$components/decks/DeckBuilder.svelte';
	import DeckList from '$components/decks/DeckList.svelte';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

	// Same three Supabase-backed stores the home page uses: the session, the
	// player's collection, and — new here — their saved decks.
	const auth = authService.store;
	const player = playerService.store;
	const decks = playerDeckService.store;

	// The player's owned cards, one id per copy.
	let ownedCardIds = $derived($player.cards);

	// The collection resolved into distinct cards with copy counts — the pool a
	// deck is built from, and the source of each card's per-deck cap. Resolving
	// reads the (memoised) catalog, so it runs in an effect that re-runs whenever
	// ownership changes; a token guards against a slow resolve overwriting a newer
	// one. Mirrors the home page's owned-cards grid.
	const cardApiAdapter = new CardApiAdapter();
	let collection = $state<{ card: CardAsset; count: number }[]>([]);
	let collectionToken = 0;
	$effect(() => {
		const ids = ownedCardIds;
		const token = ++collectionToken;
		if (ids.length === 0) {
			collection = [];
			return;
		}
		cardApiAdapter.ownedUnique(ids).then((resolved) => {
			if (token === collectionToken) collection = resolved;
		});
	});

	// Card art by id, shared with the deck list so it can render preview strips.
	let assets = $derived(new Map(collection.map(({ card }) => [card.id, card])));

	// Which deck the builder is editing, by id. The deck itself is read back out
	// of the store rather than held here, so the edits the service applies show up
	// immediately — and a deck that disappears (deleted, or a sign-out) closes the
	// builder instead of stranding it.
	let editingId = $state<string | null>(null);
	let editingDeck = $derived($decks.decks.find((deck) => deck.id === editingId) ?? null);
	$effect(() => {
		if (editingId !== null && editingDeck === null && !$decks.loading) editingId = null;
	});

	// The message from a failed write, either a delete's (thrown) or an edit's
	// (reported on the store, since nothing awaits those).
	let deleteError = $state('');
	let error = $derived(deleteError || ($decks.error ?? ''));

	// Creating a deck creates it: an empty, unnamed deck is saved right away and
	// the builder opens on it, so everything done from there edits a deck that
	// already exists.
	async function create() {
		deleteError = '';
		const id = await playerDeckService.create();
		if (id) editingId = id;
	}

	function rename(event: CustomEvent<{ name: string }>) {
		if (editingDeck) playerDeckService.update(editingDeck.id, { name: event.detail.name });
	}

	function addCard(event: CustomEvent<{ cardId: number }>) {
		if (!editingDeck) return;
		const ownedCount = collection.find(({ card }) => card.id === event.detail.cardId)?.count ?? 0;
		playerDeckService.update(editingDeck.id, {
			cards: playerDeckAdapter.addCopy(editingDeck.cards, event.detail.cardId, ownedCount)
		});
	}

	function removeCard(event: CustomEvent<{ cardId: number }>) {
		if (!editingDeck) return;
		playerDeckService.update(editingDeck.id, {
			cards: playerDeckAdapter.removeCopy(editingDeck.cards, event.detail.cardId)
		});
	}

	async function remove(event: CustomEvent<{ deck: PlayerDeck }>) {
		deleteError = '';
		try {
			await playerDeckService.remove(event.detail.deck.id);
		} catch (err) {
			deleteError = err instanceof Error ? err.message : String(err);
		}
	}

	function edit(event: CustomEvent<{ deck: PlayerDeck }>) {
		deleteError = '';
		editingId = event.detail.deck.id;
	}

	// The builder puts the deck in a side menu next to the collection grid, so it
	// gets the full page width; the deck list stays narrow.
	let mainClasses = $derived(
		classNames('mx-auto w-full space-y-6 p-4 sm:p-6 lg:p-8', {
			'max-w-7xl': editingDeck !== null,
			'max-w-4xl': editingDeck === null
		})
	);

	// Warm the catalog so the first collection resolve doesn't wait on a cold
	// fetch when the player already owns cards.
	onMount(() => {
		cardApiAdapter.loadAvailableCards();
	});
</script>

<svelte:head>
	<title>Decks · Dice Guardians</title>
</svelte:head>

<main class={mainClasses}>
	{#if !authService.configured}
		<section class="space-y-2 py-8 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Decks</h1>
			<p class="text-base-content/60 text-sm">
				Decks are saved to your account, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading}
		<section class="flex items-center justify-center py-16" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Decks</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to build decks.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else if $player.loading || $decks.loading}
		<section class="flex items-center justify-center py-16" aria-label="Loading decks">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if editingDeck !== null}
		<DeckBuilder
			deck={editingDeck}
			{collection}
			saving={$decks.saving}
			{error}
			on:rename={rename}
			on:add={addCard}
			on:remove={removeCard}
			on:done={() => (editingId = null)}
		/>
	{:else}
		<section class="space-y-4" aria-label="Your decks">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 class="text-2xl font-bold">Your decks</h1>
					<p class="text-base-content/60 text-sm">
						{$decks.decks.length}
						{$decks.decks.length === 1 ? 'deck' : 'decks'} · {DECK_SIZE} cards each, up to 3 copies
						of a card per deck
					</p>
				</div>
				<button
					class="btn btn-primary"
					disabled={collection.length === 0 || $decks.saving}
					onclick={create}
				>
					New deck
				</button>
			</div>

			{#if error}
				<div class="alert alert-error text-sm" role="alert">{error}</div>
			{/if}

			{#if $decks.decks.length > 0}
				<DeckList
					decks={$decks.decks}
					{assets}
					disabled={$decks.saving}
					on:edit={edit}
					on:remove={remove}
				/>
			{:else}
				<div
					class="border-base-300 text-base-content/60 rounded-lg border border-dashed p-8 text-center text-sm"
				>
					{#if collection.length === 0}
						You need cards before you can build a deck. Grab some on the home page first.
					{:else}
						No decks yet. Build your first one from the {collection.length} cards you own.
					{/if}
				</div>
			{/if}
		</section>
	{/if}
</main>
