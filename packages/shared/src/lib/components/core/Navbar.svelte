<script lang="ts">
	import NavMenuItems from '$components/core/NavMenuItems.svelte';
	import { routes } from '$utils/navigation/routes';

	// Heading shown above the route list; each app names its own menu.
	export let title: string = 'Menu';
</script>

<!-- The sidebar panel listing every route the app exposes. Rendered inside a
     drawer by the consuming layout, so it is a persistent column or a slide-in
     panel depending on that layout. The `navigate` event bubbles up from the
     links so the layout can close the drawer after a selection. -->
<aside class="bg-base-200 text-base-content flex min-h-full w-60 flex-col">
	<div class="border-base-300 flex h-14 items-center border-b px-4">
		<span class="text-lg font-semibold">{title}</span>
	</div>
	<nav class="flex-1 overflow-y-auto p-2">
		<NavMenuItems items={routes} on:navigate />
	</nav>
</aside>
