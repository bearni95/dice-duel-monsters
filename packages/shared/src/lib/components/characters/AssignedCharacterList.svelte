<script lang="ts">
	import classNames from 'classnames';
	import type { CharacterWithDeck } from '$adapters/character-deck.adapter';

	interface Props {
		/** Characters that have a deck assigned, already paired with it. */
		entries?: CharacterWithDeck[];
		/** Set while the decks and assignments are still being fetched. */
		loading?: boolean;
		classes?: string;
	}

	let { entries = [], loading = false, classes = '' }: Props = $props();
</script>

{#if loading}
	<div class={classNames('flex items-center justify-center py-8', classes)}>
		<span class="loading loading-spinner loading-md text-primary"></span>
	</div>
{:else if entries.length > 0}
	<!-- Rows are frosted glass, like the deck list beside them: whatever sits behind
	     the column still reads through them, blurred back so the text stays legible. -->
	<ul class={classNames('space-y-2', classes)}>
		{#each entries as { character, deck } (character.slug)}
			<li
				class="border-base-300 bg-base-100/50 flex items-center gap-3 rounded-lg border px-3 py-2 backdrop-blur-md"
			>
				<img
					src={character.src}
					alt=""
					loading="lazy"
					class="border-base-300 h-12 w-12 shrink-0 rounded-lg border object-cover [image-rendering:pixelated]"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate font-medium">{character.name}</p>
					<p class="text-base-content/60 truncate text-sm">{deck.name}</p>
				</div>
				{#if character.series}
					<span class="badge badge-ghost badge-sm shrink-0">{character.series}</span>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p
		class={classNames(
			'border-base-300 bg-base-100/50 text-base-content/60 rounded-lg border border-dashed p-6 text-center text-sm backdrop-blur-md',
			classes
		)}
	>
		No characters have a deck assigned yet.
	</p>
{/if}
