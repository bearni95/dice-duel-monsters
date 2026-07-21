<script lang="ts">
	import classNames from 'classnames';
	import type { DistinctFace } from '$types/dice.type';

	// The distinct faces a single die rolls, drawn from its baked face PNGs
	// (`${faceSrcBase}/${dieId}-${face}.png`). A face that appears more than once on
	// the die is badged with its copy count. UI only — the distinct-face list is
	// computed in the dice adapter.
	let {
		dieId,
		faces,
		faceSrcBase = '/dice/generated',
		classes = ''
	}: {
		dieId: string;
		faces: DistinctFace[];
		faceSrcBase?: string;
		classes?: string;
	} = $props();
</script>

<div class={classNames('grid w-fit grid-cols-2 gap-1', classes)}>
	{#each faces as face (face.face)}
		<div class="relative h-9 w-9">
			<img
				src={`${faceSrcBase}/${dieId}-${face.face}.png`}
				alt={`Face scoring ${face.value}`}
				class="h-9 w-9 rounded-sm"
			/>
			{#if face.count > 1}
				<span
					class="badge badge-neutral badge-xs absolute -right-1 -top-1 font-semibold"
					title={`This face appears ${face.count} times on the die`}
				>
					×{face.count}
				</span>
			{/if}
		</div>
	{/each}
</div>
