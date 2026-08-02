<script lang="ts">
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import ScatteredCardsBackdrop from '$components/cards/ScatteredCardsBackdrop.svelte';

	// The collection as a backdrop: every copy the player owns, tiled across the
	// viewport and shoved aside by the cursor. Same two Supabase-backed stores the
	// home page and the deck builder read — the session and the player's cards.
	const auth = authService.store;
	const player = playerService.store;

	// The player's owned cards, one id per copy.
	let ownedCardIds = $derived($player.cards);

	// Resolved against the catalog so the backdrop only ever draws cards this build
	// can actually render: `ownedUnique` drops ids outside the grantable allow-list
	// (cards granted under older rules, with no committed PNG behind them), which
	// would otherwise be invisible gaps in the tiling. Resolving hits the (memoised)
	// catalog, so it runs in an effect keyed on ownership, with a token guarding
	// against a slow resolve overwriting a newer one — as on the other pages.
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

	// Back to one id per copy, oldest first, which is what the backdrop tiles: the
	// cap it applies keeps the newest copies, and later ids paint on top.
	let backdropCardIds = $derived(
		collection.flatMap(({ card, count }) => Array.from({ length: count }, () => card.id))
	);

	// Warm the catalog so the first resolve doesn't wait on a cold fetch.
	onMount(() => {
		cardApiAdapter.loadAvailableCards();
	});
</script>

<svelte:head>
	<title>Collection · Dice Guardians</title>
</svelte:head>

{#if backdropCardIds.length > 0}
	<ScatteredCardsBackdrop cardIds={backdropCardIds} classes="-z-10" />
{/if}

<main class="relative mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center p-4">
	{#if !authService.configured}
		<section class="space-y-2 py-8 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/60 text-sm">
				Your collection is saved to your account, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading || ($auth.user && $player.loading)}
		<section class="flex items-center justify-center py-16" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Collection</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to see your cards.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else if collection.length === 0}
		<section class="space-y-2 py-8 text-center" aria-label="Empty collection">
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/60 text-sm">
				You don't own any cards yet. Grab some on the
				<a class="link link-primary" href="/">home page</a> and they'll show up here.
			</p>
		</section>
	{:else}
		<!-- Sits over the cards, so it gets a translucent panel rather than
		     competing with the art behind it. -->
		<section
			class="bg-base-100/70 border-base-300/60 space-y-1 rounded-xl border px-6 py-5 text-center shadow-xl backdrop-blur-sm"
			aria-label="Collection"
		>
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/70 text-sm">
				{ownedCardIds.length}
				{ownedCardIds.length === 1 ? 'card' : 'cards'} · {collection.length} unique
			</p>
			<p class="text-base-content/50 text-xs">Move your cursor through them.</p>
		</section>
	{/if}
</main>
