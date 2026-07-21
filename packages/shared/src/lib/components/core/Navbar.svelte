<script lang="ts">
	import NavMenuItems from '$components/core/NavMenuItems.svelte';
	import { routes } from '$utils/navigation/routes';
</script>

<!-- The admin sidebar panel. Rendered inside the layout's `drawer-side`, so it is
     a persistent left column on desktop and a slide-in drawer on mobile. The
     `navigate` event bubbles up from the links so the layout can close the mobile
     drawer after a selection. -->
<aside class="bg-base-200 text-base-content flex min-h-full w-60 flex-col">
	<div class="border-base-300 flex h-14 items-center border-b px-4">
		<span class="text-lg font-semibold">Admin</span>
	</div>
	<nav class="flex-1 overflow-y-auto p-2">
		<NavMenuItems items={routes} on:navigate />
	</nav>
</aside>
