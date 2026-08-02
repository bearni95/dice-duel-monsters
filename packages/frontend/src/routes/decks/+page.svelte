<script lang="ts">
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { playerDeckService } from '$services/player-deck.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import DeckBuilder from '$components/decks/DeckBuilder.svelte';
	import type { PlayerDeck } from '$types/player-deck.type';

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

	// Which deck the builder is editing, by id. The deck itself is read back out of
	// the store rather than held here, so the edits the service applies show up
	// immediately — and a deck that disappears (deleted, or a sign-out) falls back
	// to another one instead of leaving the builder blank. There is no unselected
	// state to sit in: the page always has a deck open when there is one to open.
	let selectedId = $state<string | null>(null);
	let selectedDeck = $derived(
		$decks.decks.find((deck) => deck.id === selectedId) ??
			playerDeckAdapter.activeDeck($decks.decks) ??
			$decks.decks[0] ??
			null
	);

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
		if (id) selectedId = id;
	}

	function select(event: CustomEvent<{ deck: PlayerDeck }>) {
		deleteError = '';
		selectedId = event.detail.deck.id;
	}

	function rename(event: CustomEvent<{ deckId: string; name: string }>) {
		playerDeckService.update(event.detail.deckId, { name: event.detail.name });
	}

	function addCard(event: CustomEvent<{ cardId: number }>) {
		if (!selectedDeck) return;
		const ownedCount = collection.find(({ card }) => card.id === event.detail.cardId)?.count ?? 0;
		playerDeckService.update(selectedDeck.id, {
			cards: playerDeckAdapter.addCopy(selectedDeck.cards, event.detail.cardId, ownedCount)
		});
	}

	function removeCard(event: CustomEvent<{ cardId: number }>) {
		if (!selectedDeck) return;
		playerDeckService.update(selectedDeck.id, {
			cards: playerDeckAdapter.removeCopy(selectedDeck.cards, event.detail.cardId)
		});
	}

	// Enable or disable a deck for play. The board deals from the enabled deck
	// (see playerDeckAdapter.activeDeck), so this is what picks which deck a match
	// is played with.
	function enable(event: CustomEvent<{ deck: PlayerDeck; enabled: boolean }>) {
		deleteError = '';
		void playerDeckService.setEnabled(event.detail.deck.id, event.detail.enabled);
	}

	async function remove(event: CustomEvent<{ deck: PlayerDeck }>) {
		deleteError = '';
		try {
			await playerDeckService.remove(event.detail.deck.id);
		} catch (err) {
			deleteError = err instanceof Error ? err.message : String(err);
		}
	}

	// Warm the catalog so the first collection resolve doesn't wait on a cold
	// fetch when the player already owns cards.
	onMount(() => {
		cardApiAdapter.loadAvailableCards();
	});
</script>

<svelte:head>
	<title>Decks · Dice Guardians</title>
</svelte:head>

<main class="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
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
	{:else}
		<DeckBuilder
			decks={$decks.decks}
			deck={selectedDeck}
			{collection}
			saving={$decks.saving}
			{error}
			on:create={create}
			on:select={select}
			on:enable={enable}
			on:deleteDeck={remove}
			on:rename={rename}
			on:add={addCard}
			on:remove={removeCard}
		/>
	{/if}
</main>
