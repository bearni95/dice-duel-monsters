<script lang="ts">
	import { onMount } from 'svelte';
	import type { IGameCreature } from '$adapters/creature.adapter';
	import { renderCardToPng } from '$utils/card/cardToPng';

	// Renders a card as a rasterized PNG image (produced by the same off-screen
	// renderer /print uses) instead of a live GameCard DOM tree. Used by the
	// /cards grid so every tile is the print-ready image of the card. A square-
	// ish placeholder holds the tile's space while the PNG is generated.
	let {
		card,
		width = 512,
		showStats = true,
		alt = card.name
	}: { card: IGameCreature; width?: number; showStats?: boolean; alt?: string } = $props();

	let dataUrl = $state('');
	let error = $state('');
	let loading = $state(true);

	onMount(async () => {
		try {
			const png = await renderCardToPng(card, { width, showStats });
			dataUrl = png.dataUrl;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to render the card';
		} finally {
			loading = false;
		}
	});
</script>

{#if dataUrl}
	<img src={dataUrl} {alt} class="h-auto w-full rounded" />
{:else}
	<div
		class="flex aspect-[3/4] w-full items-center justify-center rounded bg-base-200 text-xs opacity-60"
	>
		{#if loading}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if error}
			<span class="p-2 text-center text-error">{error}</span>
		{/if}
	</div>
{/if}
