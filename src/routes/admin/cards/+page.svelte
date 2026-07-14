<script lang="ts">
	import { onMount } from 'svelte';
	import CardAssetCard, { type CardAsset } from '$components/cards/GameCard.svelte';

	type CardIndex = { cards: CardAsset[] };

	const cardsPerPage = 24;
	let cards: CardAsset[] = [];
	let currentPage = 1;
	let loading = true;
	let loadError = '';

	$: pageCount = Math.max(1, Math.ceil(cards.length / cardsPerPage));
	$: visibleCards = cards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage);
	$: firstCardNumber = cards.length ? (currentPage - 1) * cardsPerPage + 1 : 0;
	$: lastCardNumber = Math.min(currentPage * cardsPerPage, cards.length);

	onMount(async () => {
		try {
			const response = await fetch('/cards/cards.json');
			if (!response.ok) throw new Error(`Could not load card data (${response.status})`);
			const index: CardIndex = await response.json();
			cards = index.cards;
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Could not load card data.';
		} finally {
			loading = false;
		}
	});

	function goToPage(page: number) {
		currentPage = Math.min(Math.max(page, 1), pageCount);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}
</script>

<svelte:head>
	<title>Card assets | Admin</title>
	<meta
		name="description"
		content="Browse the Yu-Gi-Oh! card assets available to Dice Guardians."
	/>
</svelte:head>

<main class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
	<div class="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<p class="text-sm font-medium text-primary">Admin</p>
			<h1 class="text-3xl font-bold tracking-tight">Card assets</h1>
			<p class="mt-1 text-base-content/70">Full cards and their matching monster billboards.</p>
		</div>
		{#if !loading && !loadError}
			<p class="text-sm text-base-content/70">Showing {firstCardNumber}–{lastCardNumber} of {cards.length}</p>
		{/if}
	</div>

	{#if loading}
		<div class="flex justify-center py-20" aria-live="polite">
			<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading cards"></span>
		</div>
	{:else if loadError}
		<div class="alert alert-error" role="alert">{loadError}</div>
	{:else}
		<div class="mb-6 flex items-center justify-between gap-3" aria-label="Card pagination">
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>
				Previous
			</button>
			<p class="text-sm font-medium">Page {currentPage} of {pageCount}</p>
			<button
				class="btn btn-outline btn-sm"
				onclick={() => goToPage(currentPage + 1)}
				disabled={currentPage === pageCount}
			>
				Next
			</button>
		</div>

		<section class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4" aria-label="Card list">
			{#each visibleCards as card (card.id)}
				<CardAssetCard {card} />
			{/each}
		</section>

		<div class="mt-8 flex items-center justify-between gap-3" aria-label="Card pagination">
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}>
				Previous
			</button>
			<p class="text-sm font-medium">Page {currentPage} of {pageCount}</p>
			<button
				class="btn btn-outline btn-sm"
				onclick={() => goToPage(currentPage + 1)}
				disabled={currentPage === pageCount}
			>
				Next
			</button>
		</div>
	{/if}
</main>
