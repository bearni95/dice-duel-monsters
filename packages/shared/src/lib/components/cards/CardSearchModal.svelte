<script lang="ts">
	import DatabaseFilterBar from '$components/cards/DatabaseFilterBar.svelte';
	import CardTile from '$components/cards/CardTile.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';

	// A searchable card picker, driven by the same catalog query and filter bar as
	// the /cards browser, but ending in a per-card "Select" action instead of the
	// detail/effects buttons. The parent opens it by setting `open` and receives the
	// chosen card through `onSelect`. It searches the full catalog (spells and traps
	// always surface; monsters only once they have a cutout) so any magic or trap
	// card can be associated with a spell.
	let {
		open = false,
		title = 'Select a card',
		onSelect,
		onClose
	}: {
		open?: boolean;
		title?: string;
		onSelect?: (card: CardAsset) => void;
		onClose?: () => void;
	} = $props();

	const LIMIT = 12;
	const cardApiAdapter = new CardApiAdapter();
	cardApiAdapter.limit = LIMIT;

	let page = $state(1);
	let totalCards = $state(0);
	let cards = $state<CardAsset[]>([]);
	let loading = $state(false);
	let loadError = $state('');
	let hasLoaded = $state(false);

	let search = $state('');
	// Default to spells since a spell is most often represented by a magic card;
	// the user can widen to traps or all types from the filter bar.
	let categoryFilter = $state('spell');
	let subTypeFilter = $state('all');
	let attributeFilter = $state('all');
	let raceFilter = $state('all');
	let monsterTypes = $state<string[]>([]);
	let spellTypes = $state<string[]>([]);
	let trapTypes = $state<string[]>([]);
	let filterableAttributes = $state<string[]>([]);
	let filterableRaces = $state<string[]>([]);

	let totalPages = $derived(Math.max(1, Math.ceil(totalCards / LIMIT)));
	let displayRange = $derived(
		totalCards > 0
			? `${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, totalCards)} of ${totalCards}`
			: 'No cards'
	);

	// Load the first page the first time the modal opens; kept loaded afterwards so
	// reopening keeps the last search rather than resetting it.
	$effect(() => {
		if (open && !hasLoaded) {
			hasLoaded = true;
			loadCards();
		}
	});

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

	function reload() {
		page = 1;
		loadCards();
	}

	function goToPage(p: number) {
		page = Math.min(Math.max(p, 1), totalPages);
		loadCards();
	}

	function choose(card: CardAsset) {
		onSelect?.(card);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={title}>
		<div class="modal-box max-h-[90vh] w-11/12 max-w-6xl">
			<button
				class="btn btn-circle btn-ghost btn-sm absolute top-3 right-3"
				onclick={() => onClose?.()}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<header class="pr-8">
				<h3 class="text-xl font-bold">{title}</h3>
			</header>

			<div class="mt-4 mb-4">
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
				<div class="mb-4 flex items-center justify-between gap-3" aria-label="Card pagination">
					<button class="btn btn-outline btn-sm" onclick={() => goToPage(page - 1)} disabled={page === 1}>
						Previous
					</button>
					<p class="text-sm font-medium">Page {page} of {totalPages} · {displayRange}</p>
					<button
						class="btn btn-outline btn-sm"
						onclick={() => goToPage(page + 1)}
						disabled={page === totalPages}
					>
						Next
					</button>
				</div>

				<section
					class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4"
					aria-label="Card list"
				>
					{#each cards as card (card.id)}
						<div class="flex flex-col gap-2">
							<CardTile {card} png />
							<button class="btn btn-sm btn-primary w-full" onclick={() => choose(card)}>
								Select
							</button>
						</div>
					{/each}
				</section>
			{/if}
		</div>

		<button class="modal-backdrop" onclick={() => onClose?.()} aria-label="Close">close</button>
	</div>
{/if}
