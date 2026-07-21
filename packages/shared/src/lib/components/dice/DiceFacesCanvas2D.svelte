<script lang="ts">
	import classNames from 'classnames';
	import { onDestroy } from 'svelte';
	import { renderDieFaces } from '$utils/dice/dice2d';

	// A flat 2D PixiJS preview of a die's six faces, each styled to match a settled
	// face of the 3D icon die. All previews share one renderer (see dice2d), so this
	// component just measures its width, asks for an extracted canvas, and mounts it.
	let {
		faceIcons,
		faceLabels,
		baseColor = 0xd7382f,
		cols = 3,
		gap = 4,
		classes = ''
	}: {
		faceIcons: string[];
		faceLabels: string[];
		baseColor?: number;
		cols?: number;
		gap?: number;
		classes?: string;
	} = $props();

	let host: HTMLDivElement;
	let width = $state(0);
	let canvas: HTMLCanvasElement | null = null;
	// Guards against a slower earlier render landing after a newer one (resize/props).
	let renderToken = 0;

	async function render() {
		if (width <= 0) return;
		const token = ++renderToken;
		const resolution = Math.min(window.devicePixelRatio || 1, 2);
		const next = await renderDieFaces({ faceIcons, faceLabels, baseColor, width, cols, gap, resolution });
		if (token !== renderToken || !host) return;
		next.classList.add('block', 'w-full', 'h-auto');
		canvas?.remove();
		canvas = next;
		host.appendChild(next);
	}

	// Re-render whenever the measured width or any styling input changes.
	$effect(() => {
		void [width, faceIcons, faceLabels, baseColor, cols, gap];
		render();
	});

	onDestroy(() => canvas?.remove());
</script>

<div
	bind:this={host}
	bind:clientWidth={width}
	class={classNames('block w-full leading-none', classes)}
	role="img"
	aria-label="Dice faces"
></div>
