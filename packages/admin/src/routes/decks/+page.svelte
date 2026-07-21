<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import GameCard from '$components/cards/GameCard.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { CreatureAdapter, type IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { type DeckSection, type ParsedDeck } from '$utils/deck/parseYdk';
	import { enabledCardIds, forcedCardIds } from '$utils/deck/enabledCardIds';
	import { decks as deckStore, refreshDecks, saveDeck, deleteDeck } from '$services/deck.service';
	import type { Deck } from '$types/deck.type';
	import { ygoProDeckAdapter, type ImportableDeck } from '$adapters/ygoprodeck-deck.adapter';
	import type { YgoProDeckApiDeck } from '$types/ygoprodeck.type';
	import DeckEditorModal from '$components/cards/DeckEditorModal.svelte';
	import AdminCardPreview from '$components/cards/AdminCardPreview.svelte';

	const creatureAdapter = new CreatureAdapter();
	const cardApiAdapter = new CardApiAdapter();

	// Saved decks (from the static JSON manifest), mirrored from the store so the
	// list re-renders on every change.
	let decks = $state<Deck[]>([]);

	// Playable-and-enabled card count per deck id — the same set the home preview
	// and board resolve (playable cards minus `disabled`, plus `forced` ones). It's
	// derived server-side, so it's fetched per deck and cached here; `undefined`
	// means the count is still loading.
	let enabledCounts = $state<Record<string, number>>({});

	// Which top-level tab is showing: the saved decks list or the community search.
	let activeTab = $state<'decks' | 'search'>('decks');

	// The deck currently open in the editor modal (null when closed).
	let editingDeck = $state<Deck | null>(null);

	// Mirror the store, and re-point the open deck at its refreshed copy so the
	// editor's toggles reflect what was just persisted (the modal saves through the
	// store, which refreshes the manifest). Every store change also recomputes the
	// enabled counts so the table reflects toggles made in the editor.
	deckStore.subscribe((v) => {
		decks = v;
		if (editingDeck) editingDeck = v.find((d) => d.id === editingDeck!.id) ?? editingDeck;
		refreshEnabledCounts(v);
		refreshDeckCards(v);
	});

	// Resolve each deck's enabled card count through the same endpoint the playable
	// views use, so the table's number matches what actually shows in a match.
	async function refreshEnabledCounts(list: Deck[]) {
		const counts: Record<string, number> = {};
		await Promise.all(
			list.map(async (deck) => {
				try {
					const ids = enabledCardIds(deck, [...deck.main, ...deck.extra, ...deck.side]);
					const cards = await cardApiAdapter.loadCardAssetsByIds(ids, forcedCardIds(deck));
					counts[deck.id] = cards.length;
				} catch {
					// Leave this deck's count out; the cell falls back to a placeholder.
				}
			})
		);
		enabledCounts = counts;
	}

	// Per-deck cache of the resolved card assets shown in each deck's card grid, keyed
	// by deck id. Populated alongside the enabled counts (same resolution), so every
	// deck's grid renders as soon as its cards are known; `undefined` means still
	// loading.
	let deckCards = $state<Record<string, CardAsset[]>>({});

	// Resolve every deck's card grid through the same enabled-card resolution the
	// "Enabled" count uses, so the grid mirrors the playable-and-enabled set.
	async function refreshDeckCards(list: Deck[]) {
		const map: Record<string, CardAsset[]> = {};
		await Promise.all(
			list.map(async (deck) => {
				try {
					const ids = enabledCardIds(deck, [...deck.main, ...deck.extra, ...deck.side]);
					map[deck.id] = await cardApiAdapter.loadCardAssetsByIds(ids, forcedCardIds(deck));
				} catch {
					map[deck.id] = [];
				}
			})
		);
		deckCards = map;
	}

	// Collapse a resolved deck's cards into ordered { card, count } entries so a card
	// with multiple copies renders a single PNG badged with its copy count rather than
	// rasterizing the same art several times.
	function groupCards(cards: CardAsset[]): Array<{ card: CardAsset; count: number }> {
		const order: number[] = [];
		const byId = new Map<number, { card: CardAsset; count: number }>();
		for (const card of cards) {
			const existing = byId.get(card.id);
			if (existing) {
				existing.count += 1;
			} else {
				byId.set(card.id, { card, count: 1 });
				order.push(card.id);
			}
		}
		return order.map((id) => byId.get(id)!);
	}

	// Collapse a section's id list into ordered { id, count } entries.
	function entries(ids: number[]): Array<{ id: number; count: number }> {
		const counts = new Map<number, number>();
		for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
		return [...counts].map(([id, count]) => ({ id, count }));
	}

	function asCreature(card: CardAsset): IGameCreature | null {
		try {
			return creatureAdapter.getAttributes(card);
		} catch {
			return null;
		}
	}

	// Total number of cards across all sections.
	function deckSize(d: ParsedDeck): number {
		return d.main.length + d.extra.length + d.side.length;
	}

	// Deletes the deck's JSON file; the service also clears any character
	// assignment that pointed at it.
	async function remove(d: Deck) {
		await deleteDeck(d.id);
	}

	const sections: Array<{ key: DeckSection; label: string }> = [
		{ key: 'main', label: 'Main Deck' },
		{ key: 'extra', label: 'Extra Deck' },
		{ key: 'side', label: 'Side Deck' }
	];

	// ── Community deck search ────────────────────────────────────────────
	// Search already-built decks on ygoprodeck.com (proxied through
	// /decks/search to sidestep CORS), preview them, and import into "Your
	// decks" as a normal saved deck.
	const PAGE_SIZE = 20;

	let searchQuery = $state('');
	let results = $state<YgoProDeckApiDeck[]>([]);
	let searchLoading = $state(false);
	let searchError = $state('');
	let hasMore = $state(false);

	let selectedApiDeck = $state<YgoProDeckApiDeck | null>(null);
	let previewDeck = $state<ImportableDeck | null>(null);
	let previewCards = $state<Map<number, CardAsset>>(new Map());
	let previewLoading = $state(false);
	let importedName = $state('');

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Resolve a set of card ids into their raw card assets via the local card DB.
	async function resolveCards(ids: number[]): Promise<Map<number, CardAsset>> {
		const unique = [...new Set(ids)];
		if (!unique.length) return new Map();
		const res = await fetch(`/database/cards?ids=${unique.join(',')}`);
		if (!res.ok) throw new Error(`Request failed (${res.status})`);
		const data = await res.json();
		const map = new Map<number, CardAsset>();
		for (const card of data.cards as CardAsset[]) map.set(card.id, card);
		return map;
	}

	function debouncedSearch() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => performSearch(false), 400);
	}

	async function performSearch(append: boolean) {
		searchLoading = true;
		searchError = '';
		try {
			const params = new URLSearchParams({
				limit: String(PAGE_SIZE),
				offset: String(append ? results.length : 0)
			});
			if (searchQuery.trim()) params.set('name', searchQuery.trim());

			const res = await fetch(`/decks/search?${params}`);
			if (!res.ok) throw new Error(`Search failed (${res.status})`);
			const data = await res.json();
			const decks = data.decks as YgoProDeckApiDeck[];

			if (append) {
				results = [...results, ...decks];
			} else {
				results = decks;
				selectedApiDeck = null;
				previewDeck = null;
				previewCards = new Map();
			}
			hasMore = decks.length === PAGE_SIZE;
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Search failed.';
		} finally {
			searchLoading = false;
		}
	}

	// Load a community deck into the preview panel, resolving its cards.
	async function selectApiDeck(apiDeck: YgoProDeckApiDeck) {
		selectedApiDeck = apiDeck;
		importedName = '';
		previewLoading = true;
		const parsed = ygoProDeckAdapter.fromApiDeck(apiDeck);
		previewDeck = parsed;
		try {
			previewCards = await resolveCards([...parsed.main, ...parsed.extra, ...parsed.side]);
		} catch {
			previewCards = new Map();
		} finally {
			previewLoading = false;
		}
	}

	let importing = $state(false);
	let importErrorMessage = $state('');

	// Save the previewed community deck as a static JSON file under "Your decks".
	async function importDeck() {
		if (!previewDeck || importing) return;
		importing = true;
		importErrorMessage = '';
		try {
			const saved = await saveDeck({
				name: previewDeck.name.trim() || 'Imported deck',
				main: [...previewDeck.main],
				extra: [...previewDeck.extra],
				side: [...previewDeck.side]
			});
			importedName = saved.name;
		} catch (e) {
			importErrorMessage = e instanceof Error ? e.message : 'Failed to save deck.';
		} finally {
			importing = false;
		}
	}

	function formatDate(dateStr: string): string {
		try {
			return new Date(dateStr).toLocaleDateString();
		} catch {
			return dateStr;
		}
	}

	function apiDeckCounts(apiDeck: YgoProDeckApiDeck) {
		return {
			main: ygoProDeckAdapter.parseCardIds(apiDeck.main_deck).length,
			extra: ygoProDeckAdapter.parseCardIds(apiDeck.extra_deck).length,
			side: ygoProDeckAdapter.parseCardIds(apiDeck.side_deck).length
		};
	}

	onMount(() => {
		refreshDecks();
		performSearch(false);
	});
</script>

<svelte:head>
	<title>Deck Builder</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-8 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold">Deck Builder</h1>
		<p class="text-base-content/60 text-sm">
			Browse and import already-built community decks. Pick the player and rival decks for a match
			from the <a class="link link-primary" href="/">home page</a>.
		</p>
	</header>

	<!-- Tabs: saved decks vs. community search -->
	<div role="tablist" class="tabs tabs-boxed w-fit">
		<button
			role="tab"
			class={classNames('tab', { 'tab-active': activeTab === 'decks' })}
			aria-selected={activeTab === 'decks'}
			onclick={() => (activeTab = 'decks')}
		>
			Your decks
		</button>
		<button
			role="tab"
			class={classNames('tab', { 'tab-active': activeTab === 'search' })}
			aria-selected={activeTab === 'search'}
			onclick={() => (activeTab = 'search')}
		>
			Deck search
		</button>
	</div>

	<!-- Saved decks + side assignment -->
	<section class={classNames('space-y-3', { hidden: activeTab !== 'decks' })}>
		<h2 class="text-lg font-semibold">Your decks</h2>

		{#if !decks.length}
			<p class="text-base-content/50 text-sm">
				No decks yet. Import one from the <button class="link link-primary" onclick={() => (activeTab = 'search')}>deck search</button>.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Cards</th>
							<th>Enabled</th>
							<th class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each decks as d (d.id)}
							<tr>
								<td class="font-medium">{d.name}</td>
								<td class="text-base-content/60">{deckSize(d)}</td>
								<td class="text-base-content/60">
									{#if enabledCounts[d.id] === undefined}
										<span class="loading loading-spinner loading-xs align-middle" aria-label="Counting enabled cards"></span>
									{:else}
										{enabledCounts[d.id]}
									{/if}
								</td>
								<td>
									<div class="flex justify-end gap-1">
										<button class="btn btn-xs btn-outline btn-primary" onclick={() => (editingDeck = d)}>
											Edit
										</button>
										<button class="btn btn-xs btn-ghost text-error" onclick={() => remove(d)}>
											Delete
										</button>
									</div>
								</td>
							</tr>
							<tr>
								<td colspan="4" class="bg-base-200/40 p-3">
									{#if deckCards[d.id] === undefined}
										<div class="flex justify-center py-6">
											<span class="loading loading-spinner loading-md" aria-label="Rendering cards"></span>
										</div>
									{:else if deckCards[d.id].length}
										<div class="grid grid-cols-[repeat(10,minmax(0,1fr))] gap-2">
											{#each groupCards(deckCards[d.id]) as entry (entry.card.id)}
												<div class="relative">
													<!-- The card's baked PNG via GET /print?id=…, a
													     plain file read — no per-card SPA/catalog/canvas.
													     Cards not yet baked are generated on demand, once and
													     throttled, then loaded in (see GeneratedCardImage). -->
													<AdminCardPreview card={entry.card} name={entry.card.name} />
													{#if entry.count > 1}
														<span class="badge badge-neutral badge-xs absolute top-1 right-1">
															x{entry.count}
														</span>
													{/if}
												</div>
											{/each}
										</div>
									{:else}
										<p class="text-base-content/50 py-4 text-center text-sm">
											None of this deck's cards could be rendered.
										</p>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- Deck search + import -->
	<section class={classNames('space-y-4', { hidden: activeTab !== 'search' })}>
		<h2 class="text-lg font-semibold">Deck search</h2>

		<div class="flex flex-wrap items-center gap-3">
			<input
				class="input input-bordered w-full max-w-md"
				placeholder="Search community decks by name…"
				bind:value={searchQuery}
				oninput={debouncedSearch}
			/>
			<span class="text-base-content/50 text-sm">{results.length} results</span>
		</div>

		{#if searchError}
			<div class="alert alert-error text-sm">
				<span>{searchError}</span>
			</div>
		{/if}

		<div class="flex flex-col gap-4 lg:flex-row">
			<!-- Results list -->
			<div
				class={classNames('flex flex-col gap-1', {
					'w-full': !selectedApiDeck,
					'w-full lg:w-80 lg:shrink-0': selectedApiDeck
				})}
			>
				{#each results as apiDeck, i (apiDeck.pretty_url + i)}
					{@const counts = apiDeckCounts(apiDeck)}
					{@const isSelected = selectedApiDeck?.pretty_url === apiDeck.pretty_url}
					<button
						class={classNames('w-full rounded p-3 text-left transition-colors', {
							'bg-primary/10 border-primary/30 border': isSelected,
							'hover:bg-base-200': !isSelected
						})}
						onclick={() => selectApiDeck(apiDeck)}
					>
						<div class="truncate text-sm font-medium">{apiDeck.deck_name}</div>
						<div class="text-base-content/60 mt-1 flex flex-wrap items-center gap-2 text-xs">
							<span>by {apiDeck.username}</span>
							{#if apiDeck.format}
								<span class="badge badge-xs badge-outline">{apiDeck.format}</span>
							{/if}
							<span>{counts.main}+{counts.extra}+{counts.side}</span>
						</div>
						<div class="text-base-content/40 mt-0.5 flex items-center gap-2 text-xs">
							<span>{formatDate(apiDeck.submit_date)}</span>
							<span>{apiDeck.deck_views} views</span>
						</div>
					</button>
				{/each}

				{#if searchLoading}
					<div class="flex justify-center py-8">
						<span class="loading loading-spinner loading-md"></span>
					</div>
				{/if}

				{#if hasMore && !searchLoading}
					<button class="btn btn-ghost btn-sm mt-2" onclick={() => performSearch(true)}>
						Load more
					</button>
				{/if}

				{#if !searchLoading && results.length === 0}
					<p class="text-base-content/50 py-8 text-center text-sm">No decks found.</p>
				{/if}
			</div>

			<!-- Preview panel -->
			{#if selectedApiDeck && previewDeck}
				<div class="bg-base-200 flex-1 space-y-4 rounded-lg p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div>
							<h2 class="text-lg font-bold">{selectedApiDeck.deck_name}</h2>
							<p class="text-base-content/60 text-xs">
								by {selectedApiDeck.username}
								{#if selectedApiDeck.format}| {selectedApiDeck.format}{/if}
								| {formatDate(selectedApiDeck.submit_date)}
							</p>
						</div>
						<div class="flex items-center gap-3">
							{#if importErrorMessage}
								<span class="text-error text-sm font-medium">{importErrorMessage}</span>
							{:else if importedName}
								<span class="text-success text-sm font-medium">Imported!</span>
							{/if}
							<button class="btn btn-primary btn-sm" onclick={importDeck} disabled={importing}>
								{#if importing}
									<span class="loading loading-spinner loading-xs"></span>
								{/if}
								Import deck
							</button>
						</div>
					</div>

					{#if previewLoading}
						<div class="flex justify-center py-12">
							<span class="loading loading-spinner loading-lg"></span>
						</div>
					{:else}
						{#each sections as section (section.key)}
							{@const list = entries(previewDeck[section.key])}
							{#if list.length}
								<div class="space-y-2">
									<h3 class="text-sm font-semibold">
										{section.label}
										<span class="text-base-content/50 font-normal">
											({previewDeck[section.key].length})
										</span>
									</h3>
									<div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
										{#each list as entry (entry.id)}
											{@const card = previewCards.get(entry.id)}
											<div class="relative">
												{#if card}
													{@const creature = asCreature(card)}
													{#if creature}
														<GameCard card={creature} />
													{:else}
														<article class="card border-base-300 bg-base-100 border shadow-sm">
															<div class="card-body gap-2 p-3">
																<h4 class="truncate text-xs font-semibold" title={card.name}>
																	{card.name}
																</h4>
																<img
																	class="h-auto w-full rounded"
																	src={card.cardImages?.[0]?.image_url_cropped}
																	alt={card.name}
																	loading="lazy"
																/>
															</div>
														</article>
													{/if}
												{:else}
													<article
														class="card border-error/40 bg-base-100 flex aspect-[59/86] items-center justify-center border border-dashed p-2"
													>
														<span class="text-base-content/50 text-center text-xs">
															#{entry.id}
														</span>
													</article>
												{/if}

												{#if entry.count > 1}
													<span class="badge badge-neutral badge-sm absolute top-1 right-1">
														x{entry.count}
													</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}

						{#if previewCards.size === 0}
							<p class="text-base-content/50 py-4 text-center text-sm">
								None of this deck's cards are in the local card database — its ids will still be
								saved on import.
							</p>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</section>
</div>

<DeckEditorModal deck={editingDeck} onClose={() => (editingDeck = null)} />
