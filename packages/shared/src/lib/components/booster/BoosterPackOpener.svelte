<script module lang="ts">
	export interface BoosterPackOpenerApi {
		/** Negative = up, positive = down. The magnitude is in pack-local pixels. */
		adjustCut: (deltaPx: number) => void;
		triggerCut: () => void;
		/** Pack-local pixels a single keyboard tap should move the cut. */
		readonly keyboardCutStep: number;
	}
</script>

<script lang="ts">
	import classNames from 'classnames';
	import { onDestroy, onMount } from 'svelte';
	import type { BoosterPack, PackPull } from '$types/booster.type';
	import { BoosterPackOpenerScene } from './scene/BoosterPackOpenerScene';

	// Hosts the Pixi canvas the pack is sliced open in. All the behaviour lives in
	// the scene; this component only owns its lifecycle and forwards its callbacks.
	let {
		pack,
		coverUrl = null,
		pulls,
		classes = '',
		onCardClick,
		onCardHover,
		onOpenComplete,
		onPackBoundsChange,
		onCardBoundsChange,
		onReady
	}: {
		pack: BoosterPack;
		coverUrl?: string | null;
		pulls: PackPull[];
		classes?: string;
		onCardClick?: (pull: PackPull, index: number) => void;
		onCardHover?: (pull: PackPull | null) => void;
		onOpenComplete?: () => void;
		onPackBoundsChange?: (bounds: DOMRect | null) => void;
		onCardBoundsChange?: (bounds: DOMRect[]) => void;
		onReady?: (api: BoosterPackOpenerApi) => void;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let scene: BoosterPackOpenerScene | null = null;

	onMount(() => {
		if (!host) return;
		scene = new BoosterPackOpenerScene(host, pack, coverUrl, pulls, {
			onCardClick: (pull, index) => onCardClick?.(pull, index),
			onCardHover: (pull) => onCardHover?.(pull),
			onOpenComplete: () => onOpenComplete?.(),
			onPackBoundsChange: (bounds) => onPackBoundsChange?.(bounds),
			onCardBoundsChange: (bounds) => onCardBoundsChange?.(bounds)
		});
		onReady?.({
			adjustCut: (delta) => scene?.adjustCut(delta),
			triggerCut: () => scene?.triggerCut(),
			get keyboardCutStep() {
				return scene?.keyboardCutStep ?? 12;
			}
		});
	});

	onDestroy(() => {
		scene?.destroy();
		scene = null;
	});
</script>

<div bind:this={host} class={classNames('relative h-full w-full overflow-hidden', classes)}></div>
