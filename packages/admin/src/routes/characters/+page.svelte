<script lang="ts">
	import { onMount } from 'svelte';
	import { CharacterCard } from '$components/characters';
	import { characters } from '$data/characters';
	import type { Character } from '$types/character.type';
	import type { Deck } from '$types/deck.type';
	import {
		decks as deckStore,
		characterDecks,
		refreshDecks,
		refreshAssignments,
		assignCharacterDeck
	} from '$services/deck.service';

	// Client-side filtered browse over the ported Duel Links portraits. Each card
	// carries a deck selector so a character can be given one of the static JSON
	// decks; clicking the portrait opens a lightbox preview.
	let search = $state('');
	let selected = $state<Character | null>(null);

	// Saved decks + character→deck assignments, mirrored from the stores.
	let decks = $state<Deck[]>([]);
	let assignments = $state<Record<string, string>>({});
	deckStore.subscribe((v) => (decks = v));
	characterDecks.subscribe((v) => (assignments = v));

	onMount(() => {
		refreshDecks();
		refreshAssignments();
	});

	let filtered = $derived(
		characters.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
	);
</script>

<main class="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
	<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">Characters</h1>
			<p class="text-base-content/60 text-sm">
				{filtered.length} of {characters.length} portraits
			</p>
		</div>
		<label class="input input-bordered flex max-w-xs items-center gap-2">
			<input
				type="search"
				class="grow"
				placeholder="Search characters"
				bind:value={search}
				aria-label="Search characters"
			/>
		</label>
	</div>

	{#if filtered.length === 0}
		<div class="text-base-content/50 flex flex-col items-center justify-center py-24">
			<p class="text-lg">No characters found</p>
		</div>
	{:else}
		<section
			class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4"
			aria-label="Character list"
		>
			{#each filtered as character (character.id)}
				<CharacterCard
					{character}
					{decks}
					assignedDeckId={assignments[character.slug] ?? null}
					onSelect={(c) => (selected = c)}
					onAssignDeck={(deckId) => assignCharacterDeck(character.slug, deckId)}
				/>
			{/each}
		</section>
	{/if}
</main>

{#if selected}
	<div
		class="modal modal-open"
		role="dialog"
		aria-modal="true"
		aria-label={selected.name}
		tabindex="-1"
		onclick={() => (selected = null)}
		onkeydown={(e) => e.key === 'Escape' && (selected = null)}
	>
		<div class="modal-box max-w-sm text-center">
			<img
				src={selected.src}
				alt={selected.name}
				class="mx-auto aspect-square w-64 rounded-box bg-base-200 object-cover [image-rendering:pixelated]"
			/>
			<h2 class="mt-4 text-xl font-bold">{selected.name}</h2>
			<div class="mt-2 flex items-center justify-center gap-2">
				{#if selected.series}
					<span class="badge badge-ghost">{selected.series}</span>
				{/if}
				{#if selected.rating != null}
					<span class="badge badge-primary">Rating {selected.rating}/5</span>
				{/if}
			</div>
			<div class="modal-action justify-center">
				<button class="btn btn-sm" onclick={() => (selected = null)}>Close</button>
			</div>
		</div>
		<div class="modal-backdrop"></div>
	</div>
{/if}
