<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import ScatteredCardsBackdrop from '$components/cards/ScatteredCardsBackdrop.svelte';
	import { collectionService } from '$services/collection.service';

	let { children } = $props();

	// The player's collection, tiled behind every page. It sits below the app's
	// content (-z-10) and takes no pointer events, and it's dimmed so page text
	// stays readable over the art rather than competing with it.
	const collection = collectionService.store;
</script>

<!-- Pages render directly and own the whole viewport, so there is no top bar
     (hence --navbar-h: 0). -->
<div class="contents" style:--navbar-h="0px">
	{#if $collection.cardIds.length > 0}
		<ScatteredCardsBackdrop cardIds={$collection.cardIds} classes="-z-10 opacity-30" />
	{/if}

	{@render children?.()}
</div>
