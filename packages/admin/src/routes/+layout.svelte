<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';
	import Navbar from '$components/core/Navbar.svelte';

	let { children } = $props();
</script>

<!-- The admin app IS the tooling, so the nav (which only surfaces admin sections)
     is always shown here — unlike the shipped frontend, which drops it. -->
<Navbar />
<div class="contents" style:--navbar-h="0px">
	{@render children?.()}
</div>
