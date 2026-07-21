<script lang="ts">
	// Combat hit markers: one white result square (black number) per die that scored a
	// hit, stamped over the black combat dice in the on-board anchor box. The box rolls
	// at the canvas's bottom-center (app.screen.width / 2); this overlay lives inside
	// the canvas host, so centering on the host's midline lines up with it.
	let { hits }: { hits: number[] } = $props();
</script>

<div
	class="pointer-events-none absolute bottom-6 left-1/2 z-20 flex h-[200px] w-[200px] -translate-x-1/2 flex-wrap content-center items-center justify-center gap-1.5 p-3"
>
	{#each hits as value, i (i)}
		<span
			class="flex h-9 w-9 items-center justify-center rounded-sm border border-base-300 bg-white text-base font-bold text-black shadow-md"
		>
			{value}
		</span>
	{/each}
</div>
