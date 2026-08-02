<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { playerDeckService } from '$services/player-deck.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import DeckBuilder from '$components/decks/DeckBuilder.svelte';
	import DeckList from '$components/decks/DeckList.svelte';
	import { DECK_SIZE, type PlayerDeck, type PlayerDeckCard } from '$types/player-deck.type';

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

	// Which deck the builder is editing: `null` when the builder is closed, a deck
	// when editing an existing one, and the `NEW_DECK` sentinel when creating one.
	const NEW_DECK = Symbol('new-deck');
	let editing = $state<PlayerDeck | typeof NEW_DECK | null>(null);
	let builderDeck = $derived(editing === NEW_DECK || editing === null ? null : editing);

	// The message from a failed save (the database's own, so a rule broken
	// server-side reads the same as one caught in the builder).
	let saveError = $state('');

	async function save(event: CustomEvent<{ name: string; cards: PlayerDeckCard[] }>) {
		saveError = '';
		const deckId = editing === NEW_DECK || editing === null ? null : editing.id;
		try {
			await playerDeckService.save(deckId, event.detail.name, event.detail.cards);
			editing = null;
		} catch (err) {
			saveError = err instanceof Error ? err.message : String(err);
		}
	}

	async function remove(event: CustomEvent<{ deck: PlayerDeck }>) {
		saveError = '';
		try {
			await playerDeckService.remove(event.detail.deck.id);
		} catch (err) {
			saveError = err instanceof Error ? err.message : String(err);
		}
	}

	function edit(event: CustomEvent<{ deck: PlayerDeck }>) {
		saveError = '';
		editing = event.detail.deck;
	}

	// The builder puts the deck in a side menu next to the collection grid, so it
	// gets the full page width; the deck list stays narrow.
	let mainClasses = $derived(
		classNames('mx-auto w-full space-y-6 p-4 sm:p-6 lg:p-8', {
			'max-w-7xl': editing !== null,
			'max-w-4xl': editing === null
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
	{:else if editing !== null}
		<DeckBuilder
			deck={builderDeck}
			{collection}
			saving={$decks.saving}
			error={saveError}
			on:save={save}
			on:cancel={() => {
				saveError = '';
				editing = null;
			}}
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
					onclick={() => {
						saveError = '';
						editing = NEW_DECK;
					}}
				>
					New deck
				</button>
			</div>

			{#if saveError}
				<div class="alert alert-error text-sm" role="alert">{saveError}</div>
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
