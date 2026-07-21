<script lang="ts">
	import '../css/app.css';
	import '$services/i18n';

	let { children } = $props();
</script>

<!-- The nav only ever surfaced admin tooling, which now lives in the separate
     `admin` app, so the shipped frontend renders its pages directly. -->
<div class="contents" style:--navbar-h="0px">
	{@render children?.()}
</div>
