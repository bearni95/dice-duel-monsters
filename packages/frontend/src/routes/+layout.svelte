<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import BurgerButton from '$components/core/BurgerButton.svelte';
	import SideDrawer from '$components/core/SideDrawer.svelte';
	import Navbar from '$components/core/Navbar.svelte';
	import ScatteredCardsBackdrop from '$components/cards/ScatteredCardsBackdrop.svelte';
	import { collectionService } from '$services/collection.service';

	let { children } = $props();

	// The player's collection, tiled behind every page and pushed around by the
	// cursor. It sits below the app's content (-z-10) and takes no pointer events,
	// and it's dimmed so page text stays readable over the art rather than
	// competing with it.
	const collection = collectionService.store;

	// Drives the right-hand menu. The pages own the whole viewport, so the menu
	// only ever floats above them instead of taking layout space.
	let menuOpen = $state(false);
</script>

<!-- Pages render directly (no top bar, hence --navbar-h: 0), with the burger and
     its slide-in menu overlaid in the top-right corner. -->
<div class="contents" style:--navbar-h="0px">
	{#if $collection.cardIds.length > 0}
		<ScatteredCardsBackdrop cardIds={$collection.cardIds} classes="-z-10 opacity-30" />
	{/if}

	{@render children?.()}

	<BurgerButton classes="fixed top-2 right-2 z-40" on:click={() => (menuOpen = true)} />

	<SideDrawer open={menuOpen} side="right" on:close={() => (menuOpen = false)}>
		<Navbar title="Dice Guardians" on:navigate={() => (menuOpen = false)} />
	</SideDrawer>
</div>
