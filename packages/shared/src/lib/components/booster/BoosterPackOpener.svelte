<script lang="ts">
	import classNames from 'classnames';
	import { onDestroy, onMount } from 'svelte';
	import type { BoosterPack, PackPull } from '$types/booster.type';
	import { RARITY_LABEL } from '$utils/booster/rarityTier';
	import { BoosterPackOpenerScene } from './scene/BoosterPackOpenerScene';

	// Hosts the Pixi canvas the pack is sliced open in, plus the keyboard proxies
	// that make the canvas operable without a mouse. All the animation lives in the
	// scene; this owns its lifecycle and translates key presses into scene calls.
	//
	// The host fills whatever box it is given, so a page can drop it in full-bleed.
	let {
		pack,
		coverUrl = null,
		pulls,
		classes = '',
		onCardClick,
		onFocusedChange,
		onOpenComplete
	}: {
		pack: BoosterPack;
		coverUrl?: string | null;
		pulls: PackPull[];
		classes?: string;
		onCardClick?: (pull: PackPull, index: number) => void;
		/** The card the pointer or keyboard cursor is on, for the page to caption. */
		onFocusedChange?: (pull: PackPull | null) => void;
		/** Fires once the cards have settled — the point at which the pulls are the player's. */
		onOpenComplete?: () => void;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let scene: BoosterPackOpenerScene | null = null;

	// Bounds emitted by the scene for the wrapper and each settled card. They are
	// viewport coordinates, which is what lets the proxies below position
	// themselves with `fixed` and still land exactly over the canvas.
	let packBounds = $state<DOMRect | null>(null);
	let cardBounds = $state<DOMRect[]>([]);

	// Held arrows glide the cut line continuously. The OS's own key repeat is not
	// used for this — its ~500ms lead-in and coarse cadence feel chunky — so a RAF
	// loop integrates a velocity over real frame time instead, which paces the
	// same at any frame rate.
	const CUT_VELOCITY_PX_PER_SEC = 600;
	let cutDirection: -1 | 0 | 1 = 0;
	let cutRafId: number | null = null;
	let cutLastTickMs = 0;

	function tickCut() {
		if (cutDirection === 0 || !scene) {
			cutRafId = null;
			return;
		}
		const now = performance.now();
		const dt = Math.min(0.05, (now - cutLastTickMs) / 1000); // clamp big gaps
		cutLastTickMs = now;
		scene.adjustCut(cutDirection * CUT_VELOCITY_PX_PER_SEC * dt);
		cutRafId = requestAnimationFrame(tickCut);
	}

	function startCut(dir: -1 | 1) {
		if (cutDirection === dir && cutRafId !== null) return;
		cutDirection = dir;
		cutLastTickMs = performance.now();
		if (cutRafId === null) cutRafId = requestAnimationFrame(tickCut);
	}

	function stopCut(dir: -1 | 1) {
		// Only the key actually driving the motion stops it, so holding both arrows
		// and releasing one keeps the slash gliding.
		if (cutDirection === dir) cutDirection = 0;
	}

	function handleCutKeyDown(e: KeyboardEvent) {
		if (!scene || e.altKey || e.ctrlKey || e.metaKey) return;
		if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
		e.preventDefault();
		// `e.repeat` is the OS auto-repeat; the RAF loop already advances the cut.
		if (e.repeat) return;
		startCut(e.key === 'ArrowUp' ? -1 : 1);
	}

	function handleCutKeyUp(e: KeyboardEvent) {
		if (e.key === 'ArrowUp') stopCut(-1);
		else if (e.key === 'ArrowDown') stopCut(1);
	}

	// Focus can leave the proxy mid-glide (pressing Enter removes it as the cut
	// starts), so the loop must not keep running against a dead scene.
	function handleCutBlur() {
		cutDirection = 0;
	}

	onMount(() => {
		if (!host) return;
		scene = new BoosterPackOpenerScene(host, pack, coverUrl, pulls, {
			onCardClick: (pull, index) => onCardClick?.(pull, index),
			onCardHover: (pull) => onFocusedChange?.(pull),
			onOpenComplete: () => onOpenComplete?.(),
			onPackBoundsChange: (bounds) => (packBounds = bounds),
			onCardBoundsChange: (bounds) => (cardBounds = bounds)
		});
	});

	onDestroy(() => {
		if (cutRafId !== null) cancelAnimationFrame(cutRafId);
		cutRafId = null;
		cutDirection = 0;
		scene?.destroy();
		scene = null;
	});
</script>

<div bind:this={host} class={classNames('relative h-full w-full overflow-hidden', classes)}></div>

<!--
	Keyboard proxies. They are real focusable buttons that take no pointer events,
	positioned `fixed` so they track the canvas in viewport coordinates — a mouse
	keeps clicking the canvas directly while the keyboard drives the same actions
	through these.
-->
{#if packBounds}
	<button
		type="button"
		aria-label="Aim the cut with the up and down arrows, then press Enter to slice the pack open"
		class="pointer-events-none fixed z-30 cursor-row-resize opacity-0"
		style:left="{packBounds.left}px"
		style:top="{packBounds.top}px"
		style:width="{packBounds.width}px"
		style:height="{packBounds.height}px"
		onclick={() => scene?.triggerCut()}
		onkeydown={handleCutKeyDown}
		onkeyup={handleCutKeyUp}
		onblur={handleCutBlur}
	></button>
{/if}

{#each cardBounds as rect, idx (idx)}
	<button
		type="button"
		aria-label="Card {idx + 1} of {cardBounds.length}: {pulls[idx]?.card.name ?? ''}, {RARITY_LABEL[
			pulls[idx]?.rarity ?? 'common'
		]}"
		class="pointer-events-none fixed z-30 opacity-0"
		style:left="{rect.left}px"
		style:top="{rect.top}px"
		style:width="{rect.width}px"
		style:height="{rect.height}px"
		onfocus={() => onFocusedChange?.(pulls[idx] ?? null)}
		onblur={() => onFocusedChange?.(null)}
		onclick={() => pulls[idx] && onCardClick?.(pulls[idx], idx)}
	></button>
{/each}
