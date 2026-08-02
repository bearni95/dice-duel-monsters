<script lang="ts">
	import { onMount } from 'svelte';
	import { authService } from '$services/auth.service';
	import { playerService } from '$services/player.service';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import type { PackPull } from '$types/booster.type';
	import { defaultBoosterPack } from '$data/boosterPacks';
	import { openPack, PACK_SIZE } from '$utils/booster/rarityTier';
	import { packCoverUrl } from '$utils/booster/packTextures';
	import { BoosterPackCard, BoosterPackOpenerModal } from '$components/booster';

	// Opening a pack is how cards enter a collection: the pull is simulated in the
	// browser from the same pool the home page's random grant draws from, and the
	// nine cards are written to Supabase through `playerService.grantCards` — the
	// one path that persists ownership.
	const auth = authService.store;
	const player = playerService.store;

	const pack = defaultBoosterPack;
	const cardApiAdapter = new CardApiAdapter();

	// The cards a pack can yield: every playable monster in a deck that has art
	// committed for it. Loaded once per visit.
	let availableCards = $state<CardAsset[]>([]);
	let poolLoading = $state(true);
	let error = $state('');

	// The pack's cover art, resolved from the pool so it can only ever point at a
	// card whose art actually ships. Falls back to the first card in the pool when
	// the configured cover isn't in it.
	let coverUrl = $derived.by(() => {
		if (!availableCards.length) return null;
		const cover =
			availableCards.find((card) => card.id === pack.coverCardId) ?? availableCards[0];
		return packCoverUrl(cover);
	});

	let pulls = $state<PackPull[]>([]);
	let opening = $state(false);
	// Bumped on every open so the opener canvas remounts with a fresh wrapper
	// rather than trying to re-animate the one that was just cut.
	let openSession = $state(0);
	// The grant is deferred until the cut animation finishes, so a pack that is
	// never opened costs nothing. `committed` tracks whether this session's pulls
	// have been persisted yet.
	let committed = $state(false);
	let committing = $state(false);

	let canOpen = $derived(availableCards.length > 0 && !poolLoading);

	function open() {
		if (!canOpen) return;
		error = '';
		pulls = openPack(availableCards);
		committed = false;
		openSession += 1;
		opening = true;
	}

	// Fires once the cards have settled in the canvas: that is the moment they
	// become the player's, so it is the moment they are written to Supabase.
	async function commit() {
		if (committed || committing || pulls.length === 0) return;
		committing = true;
		try {
			await playerService.grantCards(pulls.map((pull) => pull.card.id));
			committed = true;
		} catch {
			error = "Those cards couldn't be added to your collection. Try opening another pack.";
		} finally {
			committing = false;
		}
	}

	function close() {
		opening = false;
		pulls = [];
	}

	onMount(async () => {
		try {
			availableCards = await cardApiAdapter.loadAvailableCards();
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

<main class="relative mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center p-4">
	{#if !authService.configured}
		<section class="space-y-2 py-8 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Booster packs</h1>
			<p class="text-base-content/60 text-sm">
				Packs are opened into your account, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading}
		<section class="flex items-center justify-center py-16" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Booster packs</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to open packs.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else}
		<!-- Sits over the collection backdrop, so it gets a translucent panel rather
		     than competing with the art behind it. -->
		<section
			class="bg-base-100/70 border-base-300/60 w-full max-w-xs space-y-4 rounded-xl border px-6 py-5 text-center shadow-xl backdrop-blur-sm"
			aria-label="Booster packs"
		>
			<div class="space-y-1">
				<h1 class="text-2xl font-bold">Booster packs</h1>
				<p class="text-base-content/70 text-sm">
					{PACK_SIZE} cards a pack, straight into your collection.
				</p>
			</div>

			<BoosterPackCard {pack} {coverUrl} />

			{#if error}
				<p class="text-error text-sm" role="alert">{error}</p>
			{/if}

			<button
				class="btn btn-primary w-full"
				disabled={!canOpen || $player.saving}
				onclick={open}
			>
				{#if poolLoading}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Open pack
			</button>

			{#if !poolLoading && availableCards.length === 0}
				<p class="text-base-content/60 text-xs">
					No cards are available to pack yet.
				</p>
			{/if}
		</section>
	{/if}
</main>

{#if opening}
	<BoosterPackOpenerModal
		{pack}
		{coverUrl}
		{pulls}
		{openSession}
		openNextBusy={committing}
		openNextDisabled={!committed || committing || !canOpen}
		onClose={close}
		onCommit={commit}
		onOpenNext={open}
	/>
{/if}
