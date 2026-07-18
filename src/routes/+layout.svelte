<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import Navbar from '$components/core/Navbar.svelte';

	let { children } = $props();

	// The navbar only surfaces admin tooling, so hide it entirely unless the
	// admin routes/backend were enabled via ADMIN_ENABLED for local dev.
	const showNavbar = Boolean(import.meta.env.VITE_ADMIN_ENABLED);
</script>

{#if showNavbar}
	<Navbar />
{/if}
<!-- Expose the real navbar height so pages that offset content below it (e.g. the
     board) collapse that gap to 0 when the navbar isn't rendered. `contents` keeps
     this wrapper out of layout while still passing the variable to descendants. -->
<div class="contents" style:--navbar-h={showNavbar ? '4rem' : '0px'}>
	{@render children?.()}
</div>
