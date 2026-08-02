<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import BurgerButton from '$components/core/BurgerButton.svelte';
	import SideDrawer from '$components/core/SideDrawer.svelte';
	import Navbar from '$components/core/Navbar.svelte';

	let { children } = $props();

	// Drives the right-hand menu. The pages own the whole viewport, so the menu
	// only ever floats above them instead of taking layout space.
	let menuOpen = $state(false);
</script>

<!-- Pages render directly (no top bar, hence --navbar-h: 0), with the burger and
     its slide-in menu overlaid in the top-right corner. -->
<div class="contents" style:--navbar-h="0px">
	{@render children?.()}

	<BurgerButton classes="fixed top-2 right-2 z-40" on:click={() => (menuOpen = true)} />

	<SideDrawer open={menuOpen} side="right" on:close={() => (menuOpen = false)}>
		<Navbar title="Dice Guardians" on:navigate={() => (menuOpen = false)} />
	</SideDrawer>
</div>
