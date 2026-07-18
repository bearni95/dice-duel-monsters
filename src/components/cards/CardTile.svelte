<script lang="ts">
	import GameCard, { type CardAsset } from '$components/cards/GameCard.svelte';
	import { CreatureAdapter } from '$adapters/creature.adapter';

	// Single renderer used for every card on the browser: every card type renders
	// through GameCard. Monsters show their in-game creature stats; other types
	// (spells, traps, …) render the same framed art with the stat overlays hidden.
	// Below each card sit an "Original card" button (opens the detail modal) and,
	// when the parent supplies an `onEffects` handler, an "Effects" button that
	// opens the effect-implementation editor for this card. `effectCount` badges
	// how many effect templates the card already implements.
	let {
		card,
		onSelect,
		onEffects,
		effectCount = 0
	}: {
		card: CardAsset;
		onSelect?: (card: CardAsset) => void;
		onEffects?: (card: CardAsset) => void;
		effectCount?: number;
	} = $props();

	const creatureAdapter = new CreatureAdapter();

	const isMonster = $derived(creatureAdapter.isMonster(card));
	const creature = $derived(creatureAdapter.getDisplayAttributes(card));
</script>

<div class="flex flex-col gap-2">
	<GameCard card={creature} showStats={isMonster} />

	{#if onSelect}
		<button class="btn btn-sm btn-outline btn-primary w-full" onclick={() => onSelect?.(card)}>
			Original card
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
