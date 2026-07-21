<script lang="ts">
	import classNames from 'classnames';
	import type { Character } from '$types/character.type';
	import type { Deck } from '$types/deck.type';

	interface Props {
		character: Character;
		classes?: string;
		onSelect?: (character: Character) => void;
		/** When provided, renders a deck selector in the card footer. */
		decks?: Deck[];
		/** The deck id currently assigned to this character, if any. */
		assignedDeckId?: string | null;
		/** Fired when the assignment changes; `null` clears it. */
		onAssignDeck?: (deckId: string | null) => void;
	}

	let {
		character,
		classes = '',
		onSelect,
		decks,
		assignedDeckId = null,
		onAssignDeck
	}: Props = $props();

	// Render the difficulty rating as filled/empty pips out of five.
	let pips = $derived(Array.from({ length: 5 }, (_, i) => i < (character.rating ?? 0)));
</script>

<div
	class={classNames(
		'card bg-base-100 shadow-sm ring-1 ring-base-content/5 transition',
		classes
	)}
>
	<button
		type="button"
		class={classNames('block w-full', {
			'cursor-pointer transition hover:opacity-90': !!onSelect
		})}
		disabled={!onSelect}
		onclick={() => onSelect?.(character)}
		aria-label={character.name}
	>
		<figure class="aspect-square overflow-hidden rounded-t-box bg-base-200">
			<img
				src={character.src}
				alt={character.name}
				loading="lazy"
				class="h-full w-full object-cover [image-rendering:pixelated]"
			/>
		</figure>
	</button>
	<div class="card-body items-center gap-2 p-3 text-center">
		<h3 class="card-title text-sm leading-tight">{character.name}</h3>
		<div class="flex items-center gap-2">
			{#if character.series}
				<span class="badge badge-ghost badge-sm">{character.series}</span>
			{/if}
			{#if character.rating != null}
				<span class="flex gap-0.5" aria-label={`Rating ${character.rating} of 5`}>
					{#each pips as filled, i (i)}
						<span
							class={classNames('h-1.5 w-1.5 rounded-full', {
								'bg-primary': filled,
								'bg-base-content/20': !filled
							})}
						></span>
					{/each}
				</span>
			{/if}
		</div>

		{#if decks}
			<select
				class="select select-bordered select-sm w-full"
				aria-label={`Deck for ${character.name}`}
				value={assignedDeckId ?? ''}
				onchange={(e) => onAssignDeck?.(e.currentTarget.value || null)}
			>
				<option value="">No deck</option>
				{#each decks as deck (deck.id)}
					<option value={deck.id}>{deck.name}</option>
				{/each}
			</select>
		{/if}
	</div>
</div>
