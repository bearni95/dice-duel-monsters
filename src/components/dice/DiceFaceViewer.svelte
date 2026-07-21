<script lang="ts">
	import classNames from 'classnames';
	import DiceCanvas3D from '$components/dice/DiceCanvas3D.svelte';
	import IconDiceCanvas3D from '$components/dice/IconDiceCanvas3D.svelte';

	// A static gallery of a six-sided die's faces. Each face is posed flat-on toward
	// the camera by the very same 3D dice canvas used for throws (via initialValues),
	// then laid out in a DOM three-column grid so all faces can be inspected at once.
	// `variant` chooses the numeral die (DiceCanvas3D) or the icon die
	// (IconDiceCanvas3D); icon-only props are forwarded straight through.
	let {
		variant = 'numeral',
		faces = [1, 2, 3, 4, 5, 6],
		faceSize = 96,
		baseColor,
		faceIcons,
		faceLabels,
		showCaptions = true,
		classes = ''
	}: {
		variant?: 'numeral' | 'icon';
		// Face values to show, in grid order. Defaults to all six faces.
		faces?: number[];
		// Pixel size of each individual face canvas.
		faceSize?: number;
		// Die tint; undefined falls back to each canvas's own default.
		baseColor?: number;
		// Icon-variant only: URL per face value (index 0 => face 1 … 5 => face 6).
		faceIcons?: string[];
		// Icon-variant only: corner-badge text per face value.
		faceLabels?: string[];
		showCaptions?: boolean;
		classes?: string;
	} = $props();
</script>

<div class={classNames('grid grid-cols-3 gap-4', classes)}>
	{#each faces as face (face)}
		<div class="flex flex-col items-center gap-1">
			{#if variant === 'icon'}
				<IconDiceCanvas3D
					size={faceSize}
					initialValues={[face]}
					{baseColor}
					{faceIcons}
					{faceLabels}
				/>
			{:else}
				<DiceCanvas3D size={faceSize} initialValues={[face]} {baseColor} />
			{/if}
			{#if showCaptions}
				<span class="text-xs font-medium opacity-60">Face {face}</span>
			{/if}
		</div>
	{/each}
</div>
