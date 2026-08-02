<script lang="ts">
	// The board match route. All the game logic and the PixiJS renderer live in the
	// board engine (see $services/board-engine); this page is just the shell that boots
	// the engine into the canvas host and lays out the DOM overlays around it, each of
	// which reads the engine's reactive state and dispatches its commands. The hand,
	// detail preview, turn number and energy totals all render on the board canvas now,
	// so there is no DOM sidebar — the canvas fills the whole area below the navbar.
	import { onMount } from 'svelte';
	import { createBoardEngine } from '$services/board-engine.svelte';
	import BoardCardViewer from '$components/board/BoardCardViewer.svelte';
	import BoardFramePanel from '$components/board/BoardFramePanel.svelte';
	import CombatHitMarkers from '$components/board/CombatHitMarkers.svelte';
	import CombatResultCard from '$components/board/CombatResultCard.svelte';
	import CombatResultToast from '$components/board/CombatResultToast.svelte';
	import RivalTurnBadge from '$components/board/RivalTurnBadge.svelte';
	import GameOverModal from '$components/board/GameOverModal.svelte';

	const engine = createBoardEngine();

	// The canvas host the engine renders into. The engine fits the whole play area into
	// it (and re-fits on resize), so the host's box is the only measurement it needs.
	let host: HTMLDivElement;

	// Boot the renderer once the host is in the DOM; the engine returns its teardown.
	onMount(() => engine.mount(host));
</script>

<svelte:head>
	<title>Isometric Grid</title>
</svelte:head>

<!-- The board fills the space below the navbar. The game canvas takes the whole area;
     its own overlays (left dice panel, combat markers) are absolutely positioned within
     it. The player and rival "board" plaques are drawn on the canvas itself (Pixi objects
     laid flat on the isometric ground). -->
<div class="board-layout">
	<div bind:this={host} class="viewport">
		{#if engine.combatBoxHits && engine.combatBoxHits.length}
			<CombatHitMarkers hits={engine.combatBoxHits} />
		{/if}

		<!-- Left dice panel: floats over the top-left of the canvas (an absolute overlay
		     inside the canvas host, not a column that reserves space). The board is fitted
		     to the whole canvas and centered, so the panel simply sits over its margin. -->
		<aside class="absolute top-0 left-0 z-10 flex max-h-full flex-col gap-2 overflow-auto p-2">
			<!-- Board options panel: toggles the yellow play-area outline on the canvas. -->
			<BoardFramePanel visible={engine.boardFrameVisible} ontoggle={engine.toggleBoardFrame} />

			{#if engine.combatResult}
				<CombatResultCard result={engine.combatResult} />
			{/if}
		</aside>

		<!-- The card viewer: a DOM element pinned to the page's bottom-left, showing the
		     full art of the card last clicked on the canvas (a hand card, a played plaque
		     card, or an on-board creature). The clicked card wears a yellow frame on the
		     canvas and stays in the viewer until another is clicked. When the card is one
		     of the player's own on-board creatures, engine.previewUnitActions fills the row
		     above it with that unit's Move / Combat buttons. -->
		{#if engine.previewCardSrc}
			<BoardCardViewer src={engine.previewCardSrc} actions={engine.previewUnitActions} />
		{/if}
	</div>
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
		/* Height of the app navbar (DaisyUI .navbar default). The board area is offset
		   by this so the canvas sits below it, not under it. */
		--navbar-h: 4rem;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #1b1b1b;
	}

	/* The board fills the space below the navbar; the canvas host takes the whole area. */
	.board-layout {
		position: fixed;
		inset: var(--navbar-h) 0 0 0;
		display: flex;
		align-items: stretch;
	}

	/* The game canvas host: fills the board area. min-width:0 lets the flex item shrink
	   with the box (so the canvas follows it instead of forcing it wide); overflow:hidden
	   clips any transient over-paint so nothing bleeds past the edge. The left dice panel
	   floats over it as an absolute overlay. */
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
