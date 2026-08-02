<script lang="ts">
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { BoosterPackPanel } from '$components/booster';

	// The page is the opener: a pack sits on the canvas from the moment the pool
	// loads, and slicing it is the whole interaction. The panel owns the pack
	// itself; this page only signs the player in, fetches the pool, and keeps what
	// comes out of it — the pulls are written to Supabase through
	// `playerService.grantCards`, the one path that persists ownership.
	const auth = authService.store;
	const player = playerService.store;

	const cardApiAdapter = new CardApiAdapter();

	// The cards a pack can yield: the deck-derived pool the admin /decks page
	// lists, narrowed to the monsters the game can actually summon — no spells or
	// traps, and none of the extra-deck varieties. Loaded once per visit.
	let availableCards = $state<CardAsset[]>([]);
	let poolLoading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			availableCards = await cardApiAdapter.loadBoosterPool();
		} catch {
			error = "The card pool couldn't be loaded, so there's nothing to pack.";
		} finally {
			poolLoading = false;
		}
	});
</script>

<svelte:head>
	<title>Booster · Dice Guardians</title>
</svelte:head>

<main class="relative flex h-screen w-full flex-col overflow-hidden">
	{#if !authService.configured}
		<section class="m-auto space-y-2 p-4 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Booster packs</h1>
			<p class="text-base-content/60 text-sm">
				Packs are opened into your account, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading}
		<section class="m-auto flex items-center justify-center p-4" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="m-auto space-y-6 p-4 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Booster packs</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to open packs.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else if poolLoading}
		<section class="m-auto flex items-center justify-center p-4" aria-label="Loading the card pool">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if error}
		<section class="m-auto space-y-2 p-4 text-center" aria-label="Nothing to open">
			<h1 class="text-2xl font-bold">Booster packs</h1>
			<p class="text-base-content/60 text-sm">{error}</p>
		</section>
	{:else}
		<BoosterPackPanel
			pool={availableCards}
			saving={$player.saving}
			onGrant={(cardIds) => playerService.grantCards(cardIds)}
			classes="flex-1"
		/>
	{/if}
</main>
