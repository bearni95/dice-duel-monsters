<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import Navbar from '$components/core/Navbar.svelte';

	let { children } = $props();

	// The menu only surfaces admin tooling, so hide the burger + drawer entirely
	// unless the admin routes/backend were enabled via ADMIN_ENABLED for local dev.
	const showNavbar = Boolean(import.meta.env.VITE_ADMIN_ENABLED);
</script>

{#if showNavbar}
	<Navbar />
{/if}
<!-- The menu is now a floating burger + right-side drawer that overlays the app
     instead of a navbar occupying layout height, so pages never need to offset
     content below it. `contents` keeps this wrapper out of layout while still
     passing the variable to descendants. -->
<div class="contents" style:--navbar-h="0px">
	{@render children?.()}
</div>
