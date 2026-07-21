<script lang="ts">
	// The board match route. All the game logic and the PixiJS renderer live in the
	// board engine (see $services/board-engine); this page is just the shell that boots
	// the engine into the canvas host and lays out the DOM overlays / sidebar around it,
	// each of which reads the engine's reactive state and dispatches its commands.
	import { onMount } from 'svelte';
	import { createBoardEngine } from '$services/board-engine.svelte';
	import CombatHitMarkers from '$components/board/CombatHitMarkers.svelte';
	import CombatResultCard from '$components/board/CombatResultCard.svelte';
	import CombatResultToast from '$components/board/CombatResultToast.svelte';
	import RivalTurnBadge from '$components/board/RivalTurnBadge.svelte';
	import GameOverModal from '$components/board/GameOverModal.svelte';
	import BoardSidebar from '$components/board/BoardSidebar.svelte';

	const engine = createBoardEngine();

	// The flex canvas host the engine renders into, and the floating dice panel it
	// measures so the grid frames into the free space beside it.
	let host: HTMLDivElement;
	let leftPanel: HTMLElement | undefined = $state();

	// Boot the renderer once the host is in the DOM; the engine returns its teardown.
	onMount(() => engine.mount(host, leftPanel));
</script>

<svelte:head>
	<title>Isometric Grid</title>
</svelte:head>

<!-- The board fills the space below the navbar as a flex row: the game canvas on the
     left shrinks to fit, and the right column (hand + detail) is a real, space-occupying
     DOM column beside it — never overlapping the canvas. -->
<div class="board-layout">
	<!-- Game canvas: flexes to fill the space left of the right column. Its own overlays
	     (left dice panel, combat markers) are absolutely positioned within it, so they
	     track the canvas, not the whole window. The player and rival "board" plaques are
	     drawn on the canvas itself (Pixi objects laid flat on the isometric ground). -->
	<div bind:this={host} class="viewport">
		{#if engine.combatBoxHits && engine.combatBoxHits.length}
			<CombatHitMarkers hits={engine.combatBoxHits} />
		{/if}

		<!-- Left dice panel: floats over the top-left of the canvas (an absolute overlay
		     inside the canvas host, not a column that reserves space). Always rendered so
		     the engine can measure it on mount. -->
		<aside
			bind:this={leftPanel}
			class="absolute top-0 left-0 z-10 flex max-h-full flex-col gap-2 overflow-auto p-2"
		>
			{#if engine.combatResult}
				<CombatResultCard result={engine.combatResult} />
			{/if}
		</aside>
	</div>

	<BoardSidebar {engine} />
</div>

{#if engine.rivalThinking}
	<RivalTurnBadge />
{/if}

{#if engine.combatResult}
	<CombatResultToast result={engine.combatResult} />
{/if}

{#if engine.gameOver}
	<GameOverModal result={engine.gameOver} originLp={engine.ORIGIN_LP} />
{/if}

<style>
	:global(:root) {
		/* Height of the app navbar (DaisyUI .navbar default). The board row is offset
		   by this so the canvas and the right column sit below it, not under it. */
		--navbar-h: 4rem;
		/* Width of the right column (hand + detail). It's a real flex column of this
		   width; the canvas takes whatever horizontal space is left. */
		--right-col-w: 400px;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #1b1b1b;
	}

	/* The board is a flex row filling the space below the navbar: the canvas on the
	   left and the right column beside it. Being a real flex row, the two never
	   overlap — the column occupies its own horizontal space and the canvas gets the
	   remainder. */
	.board-layout {
		position: fixed;
		inset: var(--navbar-h) 0 0 0;
		display: flex;
		align-items: stretch;
	}

	/* The game canvas host: flexes to fill the space left of the right column and
	   shrinks with it. min-width:0 lets the flex item shrink below the canvas's
	   intrinsic size (so the canvas follows the box instead of forcing it wide);
	   overflow:hidden clips any transient over-paint so nothing bleeds past the edge.
	   The left dice panel floats over it as an absolute overlay. */
	.viewport {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	/* The canvas Pixi appends fills its host exactly (autoDensity keeps the CSS box
	   matched to the drawing buffer, so it never overflows on high-DPR displays). */
	.viewport :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
</style>
