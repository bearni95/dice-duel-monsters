<script lang="ts">
	import classNames from 'classnames';
	import { renderDieFaces } from '$utils/dice/dice2d';

	// Renders a die's six faces through the shared Pixi renderer (see dice2d), then
	// extracts the result to a PNG data URL and shows it as a plain <img>. Unlike
	// DiceFacesCanvas2D — which mounts the live canvas — this hands back a static
	// image, sized by CSS (full width by default) rather than the render resolution.
	let {
		faceIcons,
		faceLabels,
		baseColor = 0xd7382f,
		cols = 3,
		gap = 4,
		width = 1024,
		classes = ''
	}: {
		faceIcons: string[];
		faceLabels: string[];
		baseColor?: number;
		cols?: number;
		gap?: number;
		// Backing-store width (px) the PNG is rendered at; display width is CSS-driven.
		width?: number;
		classes?: string;
	} = $props();

	let src = $state('');
	// Guards against a slower earlier render landing after a newer one (props change).
	let renderToken = 0;

	async function render() {
		const token = ++renderToken;
		const canvas = await renderDieFaces({
			faceIcons,
			faceLabels,
			baseColor,
			width,
			cols,
			gap,
			resolution: 1
		});
		if (token !== renderToken) return;
		src = canvas.toDataURL('image/png');
	}

	// Re-render whenever any styling input changes.
	$effect(() => {
		void [faceIcons, faceLabels, baseColor, cols, gap, width];
		render();
	});
</script>

{#if src}
	<img {src} alt="Dice faces" class={classNames('block h-auto w-full', classes)} />
{/if}
