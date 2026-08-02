<script lang="ts">
	import classNames from 'classnames';
	import type { CharacterWithDeck } from '$adapters/character-deck.adapter';

	interface Props {
		/** Characters that have a deck assigned, already paired with it. */
		entries?: CharacterWithDeck[];
		/** Set while the decks and assignments are still being fetched. */
		loading?: boolean;
		/**
		 * Whether the player is in a state to start a match — they need a deck of
		 * their own to bring. Every row's button is blocked until they are.
		 */
		canChallenge?: boolean;
		/** Why challenging is blocked, shown on the disabled buttons. */
		challengeBlockedReason?: string;
		/** Starts a match against this character. */
		onChallenge?: (entry: CharacterWithDeck) => void;
		classes?: string;
	}

	let {
		entries = [],
		loading = false,
		canChallenge = false,
		challengeBlockedReason = '',
		onChallenge,
		classes = ''
	}: Props = $props();
</script>

{#if loading}
	<div class={classNames('flex items-center justify-center py-8', classes)}>
		<span class="loading loading-spinner loading-md text-primary"></span>
	</div>
{:else if entries.length > 0}
	<!-- Rows are frosted glass, like the deck list beside them: whatever sits behind
	     the column still reads through them, blurred back so the text stays legible. -->
	<ul class={classNames('space-y-2', classes)}>
		{#each entries as entry (entry.character.slug)}
			{@const character = entry.character}
			<!-- The portrait is the row's full height and flush with its edges — the
			     row is sized for it, and clips it back to the same rounded corners. -->
			<li
				class="border-base-300 bg-base-100/50 flex h-20 items-center gap-3 overflow-hidden rounded-lg border pr-3 backdrop-blur-md"
			>
				<!-- The portraits are 240px square and land here at a third of that, so they
				     are left to the browser's smooth downscaling; `pixelated` decimates
				     them into a choppy mess at this size. -->
				<img
					src={character.src}
					alt=""
					loading="lazy"
					class="h-full w-20 shrink-0 object-cover"
				/>
				<p class="min-w-0 flex-1 truncate font-medium">{character.name}</p>

				<!-- A button rather than a link to the board: it has to be disabled until
				     the player has a deck to bring, and a disabled anchor is a fiction. -->
				<button
					class="btn btn-primary btn-sm shrink-0"
					disabled={!canChallenge}
					title={canChallenge ? `Play against ${character.name}` : challengeBlockedReason}
					onclick={() => onChallenge?.(entry)}
				>
					Challenge
				</button>
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
