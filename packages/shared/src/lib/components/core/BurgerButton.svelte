<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';

	// Accessible name for the control; the button itself is icon-only.
	export let label: string = 'Open menu';
	// Lets the parent place the button (e.g. `fixed top-2 right-2 z-40`).
	export let classes: string = '';

	const dispatch = createEventDispatcher<{ click: void }>();
</script>

<button
	type="button"
	class={classNames('btn btn-square btn-ghost', classes)}
	aria-label={label}
	on:click={() => dispatch('click')}
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
