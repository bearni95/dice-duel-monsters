<script lang="ts">
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import type { PackPull } from '$types/booster.type';
	import { defaultBoosterPack } from '$data/boosterPacks';
	import { openPack } from '$utils/booster/rarityTier';
	import { packCoverUrl } from '$utils/booster/packTextures';
	import { BoosterPackOpener } from '$components/booster';

	// The page is the opener: a pack sits on the canvas from the moment the pool
	// loads, and slicing it is the whole interaction. Opening a pack is how cards
	// enter a collection — the nine pulls are written to Supabase through
	// `playerService.grantCards`, the one path that persists ownership.
	const auth = authService.store;
	const player = playerService.store;

	const pack = defaultBoosterPack;
	const cardApiAdapter = new CardApiAdapter();

	// The cards a pack can yield: the deck-derived pool the admin /decks page
	// lists, narrowed to the monsters the game can actually summon — no spells or
	// traps, and none of the extra-deck varieties. Loaded once per visit.
	let availableCards = $state<CardAsset[]>([]);
	let poolLoading = $state(true);
	let error = $state('');

	// The pack's cover art, resolved from the pool so it can only ever point at a
	// card whose art actually ships. Falls back to the first card in the pool when
	// the configured cover isn't in it.
	let coverUrl = $derived.by(() => {
		if (!availableCards.length) return null;
		const cover = availableCards.find((card) => card.id === pack.coverCardId) ?? availableCards[0];
		return packCoverUrl(cover);
	});

	let pulls = $state<PackPull[]>([]);
	// Bumped on every roll so the canvas remounts with a fresh wrapper rather than
	// trying to re-animate the one that was just cut.
	let openSession = $state(0);
	// The grant is deferred until the cut animation finishes, so a pack left
	// unopened costs nothing. `opened` flips when it does, and is what gates
	// rolling the next pack — it tracks the animation rather than the write, so a
	// grant that fails leaves the player able to move on rather than stuck on a
	// pack that can never be re-committed.
	let opened = $state(false);
	let committing = $state(false);

	let ready = $derived(availableCards.length > 0 && pulls.length > 0);

	// Roll the next pack. The pulls are decided here rather than at the cut, so the
	// scene can warm their art while the player is still aiming.
	function roll() {
		if (!availableCards.length) return;
		error = '';
		pulls = openPack(availableCards);
		opened = false;
		openSession += 1;
	}

	// Fires once the cards have settled in the canvas: that is the moment they
	// become the player's, so it is the moment they are written to Supabase.
	async function commit() {
		if (opened || committing || pulls.length === 0) return;
		opened = true;
		committing = true;
		try {
			await playerService.grantCards(pulls.map((pull) => pull.card.id));
		} catch {
			error = "Those cards couldn't be added to your collection. Try opening another pack.";
		} finally {
			committing = false;
		}
	}

	onMount(async () => {
		try {
			availableCards = await cardApiAdapter.loadBoosterPool();
			roll();
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
	{:else if !ready}
		<section class="m-auto space-y-2 p-4 text-center" aria-label="Nothing to open">
			<h1 class="text-2xl font-bold">Booster packs</h1>
			<p class="text-base-content/60 text-sm">
				{error || 'No cards are available to pack yet.'}
			</p>
		</section>
	{:else}
		<div class="min-h-0 flex-1">
			{#key openSession}
				<BoosterPackOpener
					{pack}
					{coverUrl}
					{pulls}
					onOpenComplete={commit}
				/>
			{/key}
		</div>

		<footer class="z-20 flex shrink-0 flex-col items-center gap-2 p-4">
			<!-- Only ever on screen when a grant failed, over the collection backdrop
			     the layout draws — hence the panel rather than bare text on the art. -->
			{#if error}
				<p
					class="bg-base-100/70 border-base-300/60 text-error rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-sm"
					role="alert"
				>
					{error}
				</p>
			{/if}

			<button
				class="btn bg-warning text-warning-content hover:bg-warning/80"
				disabled={!opened || committing || $player.saving}
				onclick={roll}
			>
				Open another
			</button>
		</footer>
	{/if}
</main>
