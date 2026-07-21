<script lang="ts">
	import { onMount } from 'svelte';
	import DatabaseFilterBar from '$components/cards/DatabaseFilterBar.svelte';
	import CardTile from '$components/cards/CardTile.svelte';
	import CardDetailModal from '$components/cards/CardDetailModal.svelte';
	import CardEffectsModal from '$components/cards/CardEffectsModal.svelte';
	import BoardPreviewModal from '$components/cards/BoardPreviewModal.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import type { CardDetail } from '$types/card.type';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { CreatureAdapter, type IGameCreature } from '$adapters/creature.adapter';
	import type { CardEffectImplementation } from '$types/card-effect.type';
	import { cardEffects, ensureCardEffects } from '$services/card-effects.service';

	// Server-side paginated card browser, mirroring the /database page's data flow:
	// each page and every filter change is a fresh /database/cards call. Shows every
	// card type through the shared CardTile renderer; monsters only surface once
	// they have a cutout (billboard) prepared for the board.
	const LIMIT = 24;
	const cardApiAdapter = new CardApiAdapter();
	cardApiAdapter.limit = LIMIT;

	let page = $state(1);
	let totalCards = $state(0);
	let cards = $state<CardAsset[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	let search = $state('');
	let categoryFilter = $state('all');
	let subTypeFilter = $state('all');
	let attributeFilter = $state('all');
	let raceFilter = $state('all');
	let monsterTypes = $state<string[]>([]);
	let spellTypes = $state<string[]>([]);
	let trapTypes = $state<string[]>([]);
	let filterableAttributes = $state<string[]>([]);
	let filterableRaces = $state<string[]>([]);

	// Card detail modal state: the modal shows whenever a fetch is in flight, has
	// errored, or has a card; the full record is fetched on demand per clicked tile.
	let detailCard = $state<CardDetail | null>(null);
	let detailLoading = $state(false);
	let detailError = $state('');

	// The card whose effect-implementation editor is open, or null when closed.
	let effectsCard = $state<CardAsset | null>(null);

	// The creature whose board preview modal is open, or null when closed. Built
	// from the clicked monster card so the modal can render it on the isometric grid
	// exactly as the board summons it.
	const creatureAdapter = new CreatureAdapter();
	let previewCreature = $state<IGameCreature | null>(null);

	function openBoardPreview(card: CardAsset) {
		previewCreature = creatureAdapter.getDisplayAttributes(card);
	}

	// How many effect templates each card implements, keyed by (stringified) card
	// id, so tiles can badge their count. Recomputes whenever implementations
	// change; the map is loaded from static JSON in onMount.
	let effectsMap = $state<Record<string, CardEffectImplementation[]>>({});
	cardEffects.subscribe((v) => (effectsMap = v));
	let effectCounts = $derived(
		new Map(Object.entries(effectsMap).map(([id, impls]) => [id, impls.length]))
	);

	let totalPages = $derived(Math.max(1, Math.ceil(totalCards / LIMIT)));
	let displayRange = $derived(
		totalCards > 0
			? `${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, totalCards)} of ${totalCards}`
			: 'No cards'
	);

	async function loadCards() {
		loading = true;
		loadError = '';
		try {
			const res = await cardApiAdapter.loadCatalog(
				page,
				search,
				categoryFilter,
				subTypeFilter,
				attributeFilter,
				raceFilter
			);
			cards = res.cards;
			totalCards = res.total;
			monsterTypes = res.monsterTypes;
			spellTypes = res.spellTypes;
			trapTypes = res.trapTypes;
			filterableAttributes = res.availableAttributes;
			filterableRaces = res.availableRaces;
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Could not load card data.';
		} finally {
			loading = false;
		}
	}

	// Any filter change restarts from the first page, then reloads from the server.
	function reload() {
		page = 1;
		loadCards();
	}

	async function openDetail(card: CardAsset) {
		detailCard = null;
		detailError = '';
		detailLoading = true;
		try {
			detailCard = await cardApiAdapter.loadDetail(card.id);
		} catch (error) {
			detailError = error instanceof Error ? error.message : 'Could not load card details.';
		} finally {
			detailLoading = false;
		}
	}

	function closeDetail() {
		detailCard = null;
		detailError = '';
		detailLoading = false;
	}

	function goToPage(p: number) {
		page = Math.min(Math.max(p, 1), totalPages);
		loadCards();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	onMount(() => {
		loadCards();
		ensureCardEffects();
	});
</script>

<svelte:head>
	<title>Card assets | Admin</title>
	<meta
		name="description"
		content="Browse the Yu-Gi-Oh! card assets available to Dice Guardians."
	/>
</svelte:head>

<main class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
	<div class="mb-6">
		<DatabaseFilterBar
			{search}
			{monsterTypes}
			{spellTypes}
			{trapTypes}
			{filterableAttributes}
			{filterableRaces}
			category_filter={categoryFilter}
			sub_type_filter={subTypeFilter}
			attribute_filter={attributeFilter}
			race_filter={raceFilter}
			onSearch={(q) => {
				search = q;
				reload();
			}}
			onClearSearch={() => {
				search = '';
			}}
			onCategoryFilter={(c) => {
				categoryFilter = c;
				// Changing the top-level category invalidates any sub-type selection.
				subTypeFilter = 'all';
				reload();
			}}
			onSubTypeFilter={(s) => {
				subTypeFilter = s;
				reload();
			}}
			onAttributeFilter={(a) => {
				attributeFilter = a;
				reload();
			}}
			onRaceFilter={(r) => {
				raceFilter = r;
				reload();
			}}
		/>
	</div>

	{#if loading}
		<div class="flex justify-center py-20" aria-live="polite">
			<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading cards"></span>
		</div>
	{:else if loadError}
		<div class="alert alert-error" role="alert">{loadError}</div>
	{:else if cards.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-base-content/50">
			<p class="text-lg">No cards found</p>
		</div>
	{:else}
		<div class="mb-6 flex items-center justify-between gap-3" aria-label="Card pagination">
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(page - 1)} disabled={page === 1}>
				Previous
			</button>
			<p class="text-sm font-medium">Page {page} of {totalPages} · {displayRange}</p>
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(page + 1)} disabled={page === totalPages}>
				Next
			</button>
		</div>

		<section class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-4" aria-label="Card list">
			{#each cards as card (card.id)}
				<CardTile
					{card}
					png
					onSelect={openDetail}
					onEffects={(c) => (effectsCard = c)}
					onBoardPreview={openBoardPreview}
					effectCount={effectCounts.get(String(card.id)) ?? 0}
				/>
			{/each}
		</section>

		<div class="mt-8 flex items-center justify-between gap-3" aria-label="Card pagination">
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(page - 1)} disabled={page === 1}>
				Previous
			</button>
			<p class="text-sm font-medium">Page {page} of {totalPages} · {displayRange}</p>
			<button class="btn btn-outline btn-sm" onclick={() => goToPage(page + 1)} disabled={page === totalPages}>
				Next
			</button>
		</div>
	{/if}

	<CardDetailModal
		card={detailCard}
		loading={detailLoading}
		error={detailError}
		onClose={closeDetail}
	/>

	{#if effectsCard}
		<CardEffectsModal card={effectsCard} onClose={() => (effectsCard = null)} />
	{/if}

	{#if previewCreature}
		<BoardPreviewModal creature={previewCreature} onClose={() => (previewCreature = null)} />
	{/if}
</main>
