<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import Navbar from '$components/core/Navbar.svelte';

	let { children } = $props();

	// Drives the mobile drawer. On lg+ the sidebar is always open (drawer-open),
	// so this only matters below that breakpoint.
	let menuOpen = $state(false);
</script>

<!-- The admin app IS the tooling, so its nav is always present: a persistent
     left sidebar on desktop, a slide-in drawer on mobile. --navbar-h stays 0
     because there is no top bar to offset content against. -->
<div class="drawer lg:drawer-open" style:--navbar-h="0px">
	<input id="admin-drawer" type="checkbox" class="drawer-toggle" bind:checked={menuOpen} />

	<div class="drawer-content flex flex-col">
		<!-- Mobile-only burger to reveal the drawer; hidden once the sidebar is
		     persistent at lg. -->
		<label
			for="admin-drawer"
			class="btn btn-square btn-ghost fixed top-2 left-2 z-40 lg:hidden"
			aria-label="Open menu"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</label>

		{@render children?.()}
	</div>

	<div class="drawer-side z-50">
		<label for="admin-drawer" class="drawer-overlay" aria-label="Close menu"></label>
		<Navbar title="Admin" on:navigate={() => (menuOpen = false)} />
	</div>
</div>
