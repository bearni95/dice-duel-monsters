<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { refreshDecks, refreshAssignments } from '$services/deck.service';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { enabledCardIds, forcedCardIds } from '$utils/deck/enabledCardIds';
	import { characters } from '$data/characters';
	import type { Character } from '$types/character.type';
	import type { Deck } from '$types/deck.type';
	import type { CardAsset } from '$components/cards/GameCard.svelte';

	// The root page previews the deck assigned to each character (via the
	// /admin/characters page, which writes the `slug -> deckId` assignment map).
	// One tab per character that has a deck, showing that deck's full card list
	// as the pre-baked card PNGs (GeneratedCardImage) served from the static tree —
	// the frontend never live-renders GameCard; that is /admin-only tooling.
	const cardApiAdapter = new CardApiAdapter();

	interface CharacterDeck {
		character: Character;
		deck: Deck;
		cards: CardAsset[];
	}

	let entries = $state<CharacterDeck[]>([]);
	let activeSlug = $state<string | null>(null);
	let loading = $state(true);
	let loadError = $state('');

	let active = $derived(entries.find((e) => e.character.slug === activeSlug) ?? null);

	// Which shown deck the player picked for each side of the next match (tracked by
	// character slug, since each shown deck belongs to one character). A match needs
	// both a player and a rival deck before it can start.
	let playerSlug = $state<string | null>(null);
	let cpuSlug = $state<string | null>(null);

	let playerEntry = $derived(entries.find((e) => e.character.slug === playerSlug) ?? null);
	let cpuEntry = $derived(entries.find((e) => e.character.slug === cpuSlug) ?? null);
	let canStart = $derived(!!playerEntry && !!cpuEntry);

	// Kick off the match, passing the chosen decks to the board as query params so
	// each side loads the deck the player picked here.
	function startGame() {
		if (!playerEntry || !cpuEntry) return;
		const params = new URLSearchParams({
			player: playerEntry.deck.id,
			cpu: cpuEntry.deck.id
		});
		goto(`/board?${params}`);
	}

	// A deck preview only shows playable cards: vanilla monsters, plus any
	// effect-type monster, spell, or trap that has an effect assigned on
	// /admin/cards. That filtering is applied server-side by the /database/cards
	// endpoint (via `loadCardAssetsByIds`). On top of that, cards the owner turned
	// off in the deck editor (the deck's `disabled` ids) are dropped here via
	// `enabledCardIds`, while cards forced on (`forced` ids) are passed through so
	// the server keeps them despite the playable verdict.
	async function load() {
		loading = true;
		loadError = '';
		try {
			const [decks, assignments] = await Promise.all([
				refreshDecks(),
				refreshAssignments()
			]);
			const deckById = new Map(decks.map((d) => [d.id, d]));

			// Keep only characters whose assignment resolves to an existing deck.
			const assigned = characters
				.map((character) => {
					const deckId = assignments[character.slug];
					const deck = deckId ? deckById.get(deckId) : undefined;
					return deck ? { character, deck } : null;
				})
				.filter((v): v is { character: Character; deck: Deck } => v !== null);

			entries = await Promise.all(
				assigned.map(async ({ character, deck }) => {
					const ids = enabledCardIds(deck, [...deck.main, ...deck.extra, ...deck.side]);
					const cards = await cardApiAdapter.loadCardAssetsByIds(ids, forcedCardIds(deck));
					return { character, deck, cards };
				})
			);
			activeSlug = entries[0]?.character.slug ?? null;
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Could not load decks.';
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Dice Guardians — Demo</title>
</svelte:head>

<main class="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
	{#if loading}
		<div class="flex justify-center py-20" aria-live="polite">
			<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading decks"></span>
		</div>
	{:else if loadError}
		<div class="alert alert-error" role="alert">{loadError}</div>
	{:else if !entries.length}
		<p class="text-base-content/50 text-sm">
			No character has a deck yet. Assign one from the
			<a class="link link-primary" href="/admin/characters">characters page</a>.
		</p>
	{:else}
		<div class="flex flex-col gap-6 lg:flex-row">
			<!-- Character picker: single vertical column to the left of the deck grid. -->
			<nav
				class="flex shrink-0 flex-col gap-1 lg:w-56"
				aria-label="Available characters"
			>
				<div
					class={classNames('w-full', {
						'tooltip tooltip-bottom': !canStart
					})}
					data-tip="Select a player and a rival character deck to start the game"
				>
					<button
						class="btn btn-primary btn-lg w-full"
						disabled={!canStart}
						onclick={startGame}
					>
						Start game
					</button>
				</div>

				{#each entries as entry (entry.character.slug)}
					<div
						class={classNames('flex flex-col gap-2 rounded-lg border-2 p-2 transition-colors', {
							'border-primary': entry.character.slug === activeSlug,
							'border-transparent': entry.character.slug !== activeSlug
						})}
					>
						<button
							class="grid grid-cols-2 items-center gap-3 text-left"
							aria-current={entry.character.slug === activeSlug}
							onclick={() => (activeSlug = entry.character.slug)}
						>
							<img
								src={entry.character.src}
								alt=""
								class={classNames('h-auto w-full border-2 [image-rendering:pixelated]', {
									'border-primary': entry.character.slug === activeSlug,
									'border-white': entry.character.slug !== activeSlug
								})}
							/>
							<span class="min-w-0 whitespace-pre-line text-center font-medium"
								>{entry.character.name.split(' ').join('\n')}</span
							>
						</button>
						<div class="flex gap-1">
							<button
								class={classNames('btn btn-xs flex-1', {
									'btn-primary': playerSlug === entry.character.slug,
									'btn-outline': playerSlug !== entry.character.slug
								})}
								onclick={() => (playerSlug = entry.character.slug)}
							>
								Player
							</button>
							<button
								class={classNames('btn btn-xs flex-1', {
									'btn-primary': cpuSlug === entry.character.slug,
									'btn-outline': cpuSlug !== entry.character.slug
								})}
								onclick={() => (cpuSlug = entry.character.slug)}
							>
								Rival
							</button>
						</div>
					</div>
				{/each}
			</nav>

			{#if active}
				<section class="min-w-0 flex-1 space-y-4" aria-label={`${active.character.name}'s deck`}>
					{#if active.cards.length}
						<div class="flex flex-wrap gap-4">
							{#each active.cards as card, i (`${active.deck.id}-${card.id}-${i}`)}
								<div class="w-[200px]">
									<GeneratedCardImage id={card.id} name={card.name} />
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-base-content/50 text-sm">No renderable cards in this deck.</p>
					{/if}
				</section>
			{/if}
		</div>
	{/if}
</main>
