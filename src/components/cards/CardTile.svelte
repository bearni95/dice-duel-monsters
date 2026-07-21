<script lang="ts">
	import GameCard, { type CardAsset } from '$components/cards/GameCard.svelte';
	import CardImage from '$components/cards/CardImage.svelte';
	import { CreatureAdapter } from '$adapters/creature.adapter';

	// Single renderer used for every card on the browser: every card type renders
	// through GameCard. Monsters show their in-game creature stats; other types
	// (spells, traps, …) render the same framed art with the stat overlays hidden.
	// Below each card sit an "Original card" button (opens the detail modal) and,
	// when the parent supplies an `onEffects` handler, an "Effects" button that
	// opens the effect-implementation editor for this card. `effectCount` badges
	// how many effect templates the card already implements.
	// When `png` is set the card visual is rendered from a rasterized PNG (the same
	// image /admin/print produces) instead of the live GameCard DOM. Used by the
	// /admin/cards grid; every other caller keeps the default DOM render.
	let {
		card,
		onSelect,
		onEffects,
		onBoardPreview,
		effectCount = 0,
		png = false
	}: {
		card: CardAsset;
		onSelect?: (card: CardAsset) => void;
		onEffects?: (card: CardAsset) => void;
		onBoardPreview?: (card: CardAsset) => void;
		effectCount?: number;
		png?: boolean;
	} = $props();

	const creatureAdapter = new CreatureAdapter();

	const isMonster = $derived(creatureAdapter.isMonster(card));
	const creature = $derived(creatureAdapter.getDisplayAttributes(card));

	// The board preview only applies to monsters that have a billboard cutout — the
	// same art the board summons onto the grid.
	const canPreviewOnBoard = $derived(isMonster && Boolean(card.billboard));
</script>

<div class="flex flex-col gap-2">
	{#if png}
		<CardImage card={creature} showStats={isMonster} />
	{:else}
		<GameCard card={creature} showStats={isMonster} />
	{/if}

	{#if onSelect}
		<button class="btn btn-sm btn-outline btn-primary w-full" onclick={() => onSelect?.(card)}>
			Original card
		</button>
	{/if}

	{#if onBoardPreview && canPreviewOnBoard}
		<button
			class="btn btn-sm btn-outline btn-secondary w-full"
			onclick={() => onBoardPreview?.(card)}
		>
			Board preview
		</button>
	{/if}

	{#if onEffects}
		<button class="btn btn-sm btn-outline w-full gap-1" onclick={() => onEffects?.(card)}>
			Effects
			{#if effectCount}
				<span class="badge badge-primary badge-sm">{effectCount}</span>
			{/if}
		</button>
	{/if}
</div>
