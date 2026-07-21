<script lang="ts">
	import type { IGameCreature } from '$adapters/creature.adapter';
	import GameCard from '$components/cards/GameCard.svelte';

	export let cards: IGameCreature[] = [];
</script>

<div class="grid grid-cols-5">
	{#each cards as card (card.id)}
		<GameCard {card} />
	{/each}
</div>
