<script lang="ts">
	import GameCard from '$components/cards/GameCard.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { CreatureAdapter, type IGameCreature } from '$adapters/creature.adapter';
	import { parseYdk, type DeckSection } from '$utils/deck/parseYdk';
	import { deckService } from '$services/deck.service';

	const creatureAdapter = new CreatureAdapter();

	const SAMPLE = `#main
89631139
89631139
46986414
#extra
#side`;

	let input = $state(SAMPLE);
	let loading = $state(false);
	let error = $state('');

	// id -> raw card data, populated after a fetch.
	let cardsById = $state<Map<number, CardAsset>>(new Map());
	// The parsed deck, captured at fetch time so the view only updates on submit.
	let deck = $state(parseYdk(''));

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

	async function render() {
		error = '';
		loading = true;

		try {
			const parsed = parseYdk(input);
			const ids = [...new Set([...parsed.main, ...parsed.extra, ...parsed.side])];

			if (!ids.length) {
				cardsById = new Map();
				deck = parsed;
				error = 'No card ids found in the deck list.';
				return;
			}

			const res = await fetch(`/database/cards?ids=${ids.join(',')}`);
			if (!res.ok) throw new Error(`Request failed (${res.status})`);

			const data = await res.json();
			const map = new Map<number, CardAsset>();
			for (const card of data.cards as CardAsset[]) map.set(card.id, card);

			cardsById = map;
			deck = parsed;

			// Persist as the player's deck so /board uses it as the hand.
			deckService.set({ id: 'player-deck', ...parsed });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to render deck.';
		} finally {
			loading = false;
		}
	}

	const sections: Array<{ key: DeckSection; label: string }> = [
		{ key: 'main', label: 'Main Deck' },
		{ key: 'extra', label: 'Extra Deck' },
		{ key: 'side', label: 'Side Deck' }
	];
</script>

<svelte:head>
	<title>Deck Builder</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold">Deck Renderer</h1>
		<p class="text-base-content/60 text-sm">
			Paste a ygopro deck list (.ydk) below and render it into cards.
		</p>
	</header>

	<div class="space-y-3">
		<textarea
			class="textarea textarea-bordered h-56 w-full font-mono text-sm"
			placeholder={"#main\n89631139\n89631139\n#extra\n!side"}
			bind:value={input}
		></textarea>

		<div class="flex items-center gap-3">
			<button class="btn btn-primary" onclick={render} disabled={loading}>
				{#if loading}
					<span class="loading loading-spinner loading-sm"></span>
				{/if}
				Render deck
			</button>

			{#if error}
				<span class="text-error text-sm">{error}</span>
			{/if}
		</div>
	</div>

	{#each sections as section (section.key)}
		{@const list = entries(deck[section.key])}
		{#if list.length}
			<section class="space-y-3">
				<h2 class="text-lg font-semibold">
					{section.label}
					<span class="text-base-content/50 text-sm font-normal">
						({deck[section.key].length})
					</span>
				</h2>

				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
					{#each list as entry (entry.id)}
						{@const card = cardsById.get(entry.id)}
						<div class="relative">
							{#if card}
								{@const creature = asCreature(card)}
								{#if creature}
									<GameCard card={creature} />
								{:else}
									<article class="card border-base-300 bg-base-100 border shadow-sm">
										<div class="card-body gap-2 p-4">
											<h3 class="text-sm font-semibold" title={card.name}>{card.name}</h3>
											<img
												class="h-auto w-full rounded"
												src={card.cardImages?.[0]?.image_url_cropped}
												alt={card.name}
												loading="lazy"
											/>
											<span class="text-base-content/60 text-xs">{card.type}</span>
										</div>
									</article>
								{/if}
							{:else}
								<article
									class="card border-error/40 bg-base-100 flex items-center justify-center border border-dashed p-4"
								>
									<span class="text-base-content/50 text-xs">Unknown card #{entry.id}</span>
								</article>
							{/if}

							{#if entry.count > 1}
								<span class="badge badge-neutral absolute top-2 right-2">x{entry.count}</span>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>
