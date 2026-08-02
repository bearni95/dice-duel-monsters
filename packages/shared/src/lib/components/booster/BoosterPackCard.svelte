<script lang="ts">
	import classNames from 'classnames';
	import type { BoosterPack } from '$types/booster.type';

	// The unopened wrapper as DOM, shown on the page before the opener takes over.
	// PackSprite paints the same three sections on the canvas, so the pack the
	// player clicks is the pack they then slice open.
	let {
		pack,
		coverUrl = null,
		classes = ''
	}: { pack: BoosterPack; coverUrl?: string | null; classes?: string } = $props();

	let rootClasses = $derived(
		classNames(
			'flex w-full flex-col overflow-hidden rounded-lg border-2 border-black shadow-xl',
			'bg-gradient-to-br from-warning/30 via-base-300 to-base-100',
			classes
		)
	);
</script>

<div class={rootClasses}>
	<div
		class="relative flex aspect-[10/3] w-full items-center justify-center overflow-hidden px-3 text-center"
	>
		{#if coverUrl}
			<img
				src={coverUrl}
				alt=""
				aria-hidden="true"
				class="absolute inset-0 h-full w-full -scale-y-100 object-cover object-top"
			/>
		{/if}
		<div
			aria-hidden="true"
			class="bg-base-100/40 absolute inset-0 backdrop-blur-md [mask-image:linear-gradient(to_top,transparent_0%,black_100%)] [-webkit-mask-image:linear-gradient(to_top,transparent_0%,black_100%)]"
		></div>
		<span
			class="text-base-content relative z-10 line-clamp-2 px-2 text-center text-lg font-bold tracking-wider uppercase [-webkit-text-stroke:1px_black] [paint-order:stroke_fill] [text-shadow:0_2px_4px_rgba(0,0,0,0.8)]"
		>
			{pack.label}
		</span>
	</div>

	<div class="relative aspect-square w-full overflow-hidden">
		{#if coverUrl}
			<img src={coverUrl} alt={pack.label} class="absolute inset-0 h-full w-full object-cover" />
		{/if}
	</div>

	<div
		class="relative flex aspect-[10/3] w-full items-center justify-center overflow-hidden px-3 text-center"
	>
		{#if coverUrl}
			<img
				src={coverUrl}
				alt=""
				aria-hidden="true"
				class="absolute inset-0 h-full w-full -scale-y-100 object-cover object-bottom"
			/>
		{/if}
		<div
			aria-hidden="true"
			class="bg-base-100/40 absolute inset-0 backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent_0%,black_100%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0%,black_100%)]"
		></div>
		{#if pack.category}
			<span
				class="text-base-content relative z-10 line-clamp-2 px-2 text-center text-xs font-semibold tracking-wider uppercase italic [-webkit-text-stroke:0.5px_black] [paint-order:stroke_fill] [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]"
			>
				{pack.category}
			</span>
		{/if}
	</div>
</div>
