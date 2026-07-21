<script lang="ts">
	import classNames from 'classnames';
	import NavMenuItems from '$components/core/NavMenuItems.svelte';
	import { routes } from '$utils/navigation/routes';

	// Whether the right-side menu is open. Toggled by the burger button and
	// closed by the backdrop, the close button, or navigating to a route.
	let open = false;

	function toggle() {
		open = !open;
	}

	function close() {
		open = false;
	}
</script>

<!-- Burger button, fixed to the top-right of the app. Replaces the full navbar. -->
<button
	type="button"
	class="btn btn-square btn-ghost fixed top-2 right-2 z-50"
	aria-label="Open menu"
	aria-expanded={open}
	on:click={toggle}
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
</button>

<!-- Backdrop: dims the app and closes the menu when clicked. -->
{#if open}
	<button
		type="button"
		class="fixed inset-0 z-40 cursor-default bg-black/40"
		aria-label="Close menu"
		on:click={close}
	></button>
{/if}

<!-- Foldable right-side drawer holding the full, nested route tree. -->
<aside
	class={classNames(
		'bg-base-200 fixed inset-y-0 right-0 z-50 flex w-72 max-w-[80vw] flex-col shadow-xl transition-transform duration-200 ease-out',
		{ 'translate-x-0': open, 'translate-x-full': !open }
	)}
	aria-hidden={!open}
>
	<div class="flex items-center justify-between p-2">
		<span class="px-2 font-semibold">Menu</span>
		<button
			type="button"
			class="btn btn-square btn-ghost btn-sm"
			aria-label="Close menu"
			on:click={close}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M6 18L18 6M6 6l12 12"
				/>
			</svg>
		</button>
	</div>
	<nav class="flex-1 overflow-y-auto p-2">
		<NavMenuItems items={routes} on:navigate={close} />
	</nav>
</aside>
