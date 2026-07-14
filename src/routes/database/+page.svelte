<script lang="ts">
	import CardGrid from '$components/cards/CardGrid.svelte';
	import DatabaseFilterBar from '$components/cards/DatabaseFilterBar.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { CreatureAdapter, type IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';

	let page = $state(1);
	let totalCards = $state(0);
	let cards = $state<IGameCreature[]>([]);
	let loading = $state(false);
	let search = $state('');
	let type_filter = $state<string>('all');
	let attribute_filter = $state<string>('all');
	let race_filter = $state<string>('all');
	let filterableTypes: string[] = [];
	let filterableAttributes: string[] = [];
	let filterableRaces: string[] = [];

	const LIMIT = 100;

	const creatureAdapter = new CreatureAdapter()
const cardApiAdapter = new CardApiAdapter()

	async function loadCards(p: number, q: string = '', type: string = 'all', attr: string = 'all', race: string = 'all') {
		loading = true;
		try {
			const params = new URLSearchParams({
				limit: String(LIMIT),
				offset: String((p - 1) * LIMIT),
			});
			if (q.trim()) params.set('q', q.trim());
			if (type !== 'all') params.set('type', type);
			if (attr !== 'all') params.set('attribute', attr);
			if (race !== 'all') params.set('race', race);

			//const res = await fetch(`/database/cards?${params}`);
			//const data = await res.json();
			
			
			const res = await cardApiAdapter.load(p,q,type,attr,race)
			
			//cards = data.cards.filter((c:CardAsset) => c.lvl).map((c: CardAsset) => creatureAdapter.getAttributes(c))
			cards = cardApiAdapter.cards
			totalCards = cardApiAdapter.totalCards;
			filterableTypes = res.availableTypes;
			filterableAttributes = res.availableAttributes;
			filterableRaces = res.availableRaces;

			if (p === 1) {
				page = 1;
			}
		} catch (e) {
			console.error('Failed to load cards:', e);
		} finally {
			loading = false;
		}
	}

	function handleSearch(q: string) {
		search = q;
		page = 1;
		loadCards(1, q, type_filter, attribute_filter, race_filter);
	}

	function handleTypeFilter(type: string) {
		type_filter = type;
		page = 1;
		loadCards(1, search, type, attribute_filter, race_filter);
	}

	function handleAttributeFilter(attr: string) {
		attribute_filter = attr;
		page = 1;
		loadCards(1, search, type_filter, attr, race_filter);
	}

	function handleRaceFilter(race: string) {
		race_filter = race;
		page = 1;
		loadCards(1, search, type_filter, attribute_filter, race);
	}

	function goToPage(p: number) {
		page = p;
		loadCards(p, search, type_filter, attribute_filter, race_filter);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	$effect(() => {
		loadCards(page, search, type_filter, attribute_filter, race_filter);
	});

	let totalPages = $derived(Math.max(1, Math.ceil(totalCards / LIMIT)));
	let displayRange = $derived(totalCards > 0
		? `${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, totalCards)} of ${totalCards}`
		: 'No cards');
</script>

<div class="container mx-auto max-w-7xl px-4 py-8">
	<div class="mb-6">
		<h1 class="text-3xl font-bold">Card Database</h1>
		<p class="mt-1 text-sm text-base-content/60">Browse all {totalCards.toLocaleString()} cards from YGOProDeck</p>
	</div>

	<DatabaseFilterBar
		{search}
		filterableTypes={filterableTypes}
		filterableAttributes={filterableAttributes}
		filterableRaces={filterableRaces}
		type_filter={type_filter}
		attribute_filter={attribute_filter}
		race_filter={race_filter}
	onSearch={handleSearch}
	onClearSearch={() => { search = ''; }}
	onTypeFilter={handleTypeFilter}
	onAttributeFilter={handleAttributeFilter}
	onRaceFilter={handleRaceFilter}
	/>

	{#if loading}
		<div class="flex justify-center py-20">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</div>
	{:else if cards.length === 0 && totalCards === 0}
		<div class="flex flex-col items-center justify-center py-24 text-base-content/50">
			<svg xmlns="http://www.w3.org/2000/svg" class="mb-4 h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
			</svg>
			<p class="text-lg">No cards found</p>
		</div>
	{:else}
		<CardGrid {cards} />
	{/if}

	{#if totalPages > 1}
		<div class="mt-8 flex flex-col items-center gap-4">
			<p class="text-sm text-base-content/60">{displayRange}</p>
			<div class="join">
				<button
					class="join-item btn btn-sm"
					onclick={() => goToPage(Math.max(1, page - 1))}
					disabled={page <= 1}
				>
					«
				</button>
				{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
					{#if totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1}
						{#if totalPages > 7 && p !== 1 && p !== totalPages && Math.abs(p - page) > 1}
							<span class="join-item btn btn-sm btn-disabled">…</span>
						{:else}
							<button
								class={p === page ? 'join-item btn btn-sm btn-primary' : 'join-item btn btn-sm'}
								onclick={() => goToPage(p)}
							>
								{p}
							</button>
						{/if}
					{/if}
				{/each}
				<button
					class="join-item btn btn-sm"
					onclick={() => goToPage(Math.min(totalPages, page + 1))}
					disabled={page >= totalPages}
				>
					»
				</button>
			</div>
		</div>
	{/if}
</div>
