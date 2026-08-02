<script lang="ts">
	import classNames from 'classnames';
	import { onDestroy } from 'svelte';
	import type { BoosterPack, PackPull } from '$types/booster.type';
	import { RARITY_LABEL } from '$utils/booster/rarityTier';
	import BoosterPackOpener, { type BoosterPackOpenerApi } from './BoosterPackOpener.svelte';

	let {
		pack,
		coverUrl = null,
		pulls,
		openSession,
		openNextBusy = false,
		openNextDisabled = false,
		onClose,
		onCommit,
		onOpenNext
	}: {
		pack: BoosterPack;
		coverUrl?: string | null;
		pulls: PackPull[];
		/** Bumped on every open, so the canvas remounts with a fresh wrapper. */
		openSession: number;
		/** True while the parent is preparing the next pack. */
		openNextBusy?: boolean;
		openNextDisabled?: boolean;
		onClose: () => void;
		/** Fires once the cards have settled — the parent persists them here. */
		onCommit: () => void;
		onOpenNext: () => void;
	} = $props();

	// Bounds emitted by the scene for the cut proxy and each revealed card. They
	// are viewport coordinates, which is what lets the proxies below position
	// themselves with `fixed` and still land exactly over the canvas.
	let packBounds = $state<DOMRect | null>(null);
	let cardBounds = $state<DOMRect[]>([]);
	let openerApi: BoosterPackOpenerApi | null = $state(null);

	// The card the pointer (or the keyboard cursor) is currently on, captioned
	// under the canvas so a pull can be identified without leaving the reveal.
	let focused = $state<PackPull | null>(null);

	// The cut proxy grabs focus as soon as it mounts: without it the keyboard
	// cursor sits on Close, and the first Enter dismisses the modal instead of
	// slicing the pack.
	let cutProxyEl = $state<HTMLButtonElement | null>(null);
	$effect(() => {
		cutProxyEl?.focus();
	});

	// Held arrows glide the cut line continuously. The OS's own key repeat is not
	// used for this — its ~500ms lead-in and coarse cadence feel chunky — so a RAF
	// loop integrates a velocity over real frame time instead, which paces the
	// same at any frame rate.
	const CUT_VELOCITY_PX_PER_SEC = 600;
	let cutDirection: -1 | 0 | 1 = 0;
	let cutRafId: number | null = null;
	let cutLastTickMs = 0;

	function tickCut() {
		if (cutDirection === 0 || !openerApi) {
			cutRafId = null;
			return;
		}
		const now = performance.now();
		const dt = Math.min(0.05, (now - cutLastTickMs) / 1000); // clamp big gaps
		cutLastTickMs = now;
		openerApi.adjustCut(cutDirection * CUT_VELOCITY_PX_PER_SEC * dt);
		cutRafId = requestAnimationFrame(tickCut);
	}

	function startCut(dir: -1 | 1) {
		if (cutDirection === dir && cutRafId !== null) return;
		cutDirection = dir;
		cutLastTickMs = performance.now();
		if (cutRafId === null) cutRafId = requestAnimationFrame(tickCut);
	}

	function stopCut(dir: -1 | 1) {
		// Only the key that is actually driving the motion stops it, so holding
		// both arrows and releasing one keeps the slash gliding.
		if (cutDirection === dir) cutDirection = 0;
	}

	function handleCutKeyDown(e: KeyboardEvent) {
		if (!openerApi || e.altKey || e.ctrlKey || e.metaKey) return;
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

	function handleWindowKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	onDestroy(() => {
		if (cutRafId !== null) cancelAnimationFrame(cutRafId);
		cutRafId = null;
		cutDirection = 0;
	});
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 sm:p-6"
	role="dialog"
	aria-modal="true"
	aria-label="{pack.label} booster pack"
>
	<div
		class="bg-base-100 flex h-full max-h-full w-full max-w-6xl flex-col gap-4 overflow-hidden rounded-lg p-4 shadow-2xl"
	>
		<div class="flex shrink-0 items-center justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold">{pack.label}</h2>
				<p class="text-xs opacity-60">
					Click anywhere along the pack to slice it open, or aim with ↑/↓ and press Enter
				</p>
			</div>
			<button type="button" class="btn btn-sm btn-ghost" onclick={onClose}>Close</button>
		</div>

		<div class="from-base-300/80 to-base-200 min-h-0 flex-1 rounded-md bg-gradient-to-b">
			{#key openSession}
				<BoosterPackOpener
					{pack}
					{coverUrl}
					{pulls}
					onOpenComplete={onCommit}
					onCardHover={(pull) => (focused = pull)}
					onPackBoundsChange={(bounds) => (packBounds = bounds)}
					onCardBoundsChange={(bounds) => (cardBounds = bounds)}
					onReady={(api) => (openerApi = api)}
				/>
			{/key}
		</div>

		<div class="flex shrink-0 items-center justify-between gap-3">
			<p class="min-w-0 truncate text-sm" aria-live="polite">
				{#if focused}
					<span class="font-medium">{focused.card.name}</span>
					<span class="opacity-60"> · {RARITY_LABEL[focused.rarity]}</span>
				{:else}
					<span class="opacity-60">{pulls.length} cards in this pack</span>
				{/if}
			</p>
			<button
				type="button"
				class={classNames('btn btn-sm bg-warning text-warning-content hover:bg-warning/80', {
					'cursor-wait': openNextBusy
				})}
				disabled={openNextDisabled}
				onclick={onOpenNext}
			>
				{#if openNextBusy}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Open another
			</button>
		</div>

		<!--
			Keyboard proxies. They are real focusable buttons living inside the
			dialog, but they take no pointer events and their `fixed` positioning
			escapes the modal's flex layout to track the canvas in viewport
			coordinates — so a mouse still clicks the canvas directly while the
			keyboard drives the same actions through these.
		-->
		{#if packBounds}
			<button
				type="button"
				aria-label="Aim the cut with the up and down arrows, then press Enter to slice the pack open"
				class="pointer-events-none fixed z-[60] cursor-row-resize opacity-0"
				style:left="{packBounds.left}px"
				style:top="{packBounds.top}px"
				style:width="{packBounds.width}px"
				style:height="{packBounds.height}px"
				bind:this={cutProxyEl}
				onclick={() => openerApi?.triggerCut()}
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
				class="pointer-events-none fixed z-[60] opacity-0"
				style:left="{rect.left}px"
				style:top="{rect.top}px"
				style:width="{rect.width}px"
				style:height="{rect.height}px"
				onfocus={() => (focused = pulls[idx] ?? null)}
				onblur={() => (focused = null)}
			></button>
		{/each}
	</div>
</div>
