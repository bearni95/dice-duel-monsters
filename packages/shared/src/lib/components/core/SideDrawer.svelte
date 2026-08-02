<script lang="ts">
	import classNames from 'classnames';
	import { createEventDispatcher } from 'svelte';

	// Whether the panel is slid into view.
	export let open: boolean = false;
	// Which edge the panel is anchored to and slides in from.
	export let side: 'left' | 'right' = 'right';
	// Extra classes for the sliding panel (width, background, ...).
	export let classes: string = '';
	// Accessible name for the click-away overlay.
	export let closeLabel: string = 'Close menu';

	const dispatch = createEventDispatcher<{ close: void }>();

	const sideClasses: Record<'left' | 'right', string> = {
		left: 'left-0',
		right: 'right-0'
	};

	// Where the panel parks while closed, so it slides back out the edge it came
	// from rather than always to the right.
	const closedClasses: Record<'left' | 'right', string> = {
		left: '-translate-x-full',
		right: 'translate-x-full'
	};

	$: panelClasses = classNames(
		'fixed top-0 bottom-0 z-50 flex transition-transform duration-200 ease-out',
		sideClasses[side],
		open ? 'translate-x-0' : closedClasses[side],
		classes
	);

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			dispatch('close');
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Click-away backdrop. Only mounted while open so it never swallows clicks
     meant for the page underneath. -->
{#if open}
	<button
		type="button"
		class="fixed inset-0 z-50 bg-black/50"
		aria-label={closeLabel}
		on:click={() => dispatch('close')}
	></button>
{/if}

<!-- The panel stays mounted so the slide animates both ways; `inert` keeps its
     contents out of tab order and the accessibility tree while closed. -->
<div class={panelClasses} inert={!open}>
	<slot />
</div>
