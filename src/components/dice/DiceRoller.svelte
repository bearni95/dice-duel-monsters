<script lang="ts">
	import classNames from 'classnames';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import rollDie from '$utils/dice/rollDie';
	import type DiceBox from '@3d-dice/dice-box';

	// Energy points counter, owned by the parent so it can drive game state.
	// `onEndTurn` lets the parent react when the player ends their turn (e.g. to
	// hand control to the CPU rival).
	let {
		energyPoints = 0,
		rivalFaces = [],
		rivalEnergy = 0,
		rivalThinking = false,
		turnNumber = 1,
		unfolding = false,
		combatHits = null,
		onRoll,
		onUnfold,
		onEndTurn
	}: {
		energyPoints?: number;
		// The rival's last 2d6 roll (null faces before its first turn), its
		// remaining energy, and whether it's currently taking its turn, shown as a
		// read-only mirror row.
		rivalFaces?: (number | null)[];
		rivalEnergy?: number;
		rivalThinking?: boolean;
		// The shared turn number, shown as a read-only rule banner.
		turnNumber?: number;
		// Whether the board is currently in unfold mode, so the button can reflect
		// the active state and offer to cancel.
		unfolding?: boolean;
		// The player's last combat roll's hit dice (values at/above the target's
		// defense). Each is stamped as a white result square (black number) over the
		// black dice in the box, marking which of the tumbling dice scored a hit.
		combatHits?: number[] | null;
		onRoll?: (total: number) => void;
		// Toggle unfold mode on the board (unfold a dice net for a fixed 6 EP).
		onUnfold?: () => void;
		onEndTurn?: () => void | Promise<void>;
	} = $props();

	// The fixed energy cost of an Unfold action, mirrored from the board.
	const UNFOLD_COST = 6;

	// Three d6, rolled as real 3D dice inside the box below.
	const DICE_COUNT = 3;

	// The player's last rolled total, shown next to the dice (null until rolled).
	let total = $state<number | null>(null);
	// Once rolled, the turn is spent: roll is disabled until "End Turn".
	let rolled = $state(false);
	// True while the 3D dice are tumbling (physics simulation running).
	let rolling = $state(false);

	// The dice-box instance and whether it has finished loading its assets. The
	// canvas is injected into the div below by id.
	let diceBox: DiceBox | null = null;
	let ready = $state(false);

	const DICE_BOX_ID = 'you-dice-box';

	onMount(async () => {
		if (!browser) return;

		// dice-box pulls in WebGL + an ammo.js wasm physics world, so it can only
		// be loaded in the browser (never during SSR).
		const { default: DiceBox } = await import('@3d-dice/dice-box');

		diceBox = new DiceBox({
			container: `#${DICE_BOX_ID}`,
			assetPath: '/assets/dice-box/',
			theme: 'default',
			themeColor: '#2e8555',
			scale: 7,
			// Run the physics/render on the main thread; the offscreen worker path
			// isn't needed for a three-dice panel and keeps asset resolution simple.
			offscreen: false,
			enableShadows: true
		});

		// The library builds its own canvas in the constructor; stretch it to fill
		// our sized container so the dice aren't clipped to the default 300x150.
		if (diceBox.canvas) {
			diceBox.canvas.style.width = '100%';
			diceBox.canvas.style.height = '100%';
			diceBox.canvas.style.display = 'block';
		}

		await diceBox.init();
		ready = true;

		// The player's dice roll automatically at the start of each of their turns,
		// including the opening one that begins as soon as the box is ready.
		roll();
	});

	onDestroy(() => {
		diceBox?.clear?.();
	});

	async function roll() {
		if (rolled || rolling || !ready || !diceBox) return;

		rolling = true;

		const results = await diceBox.roll(`${DICE_COUNT}d6`);
		const sum = results.reduce((acc, result) => acc + (result.value ?? 0), 0);

		total = sum;
		rolled = true;
		rolling = false;
		onRoll?.(sum);
	}

	// Roll a pool of `count` d6 in the shared 3D dice box and return the individual
	// face values. Used by the board to roll a summoned creature's HP dice and the
	// rival's energy dice where they can be watched tumbling. An optional
	// `themeColor` tints just this roll (e.g. blue for the rival). Falls back to a
	// plain RNG if the box isn't ready yet, so a roll never blocks on missing assets.
	export async function rollPool(count: number, themeColor?: string): Promise<number[]> {
		if (count <= 0) return [];

		if (!ready || !diceBox) {
			return Array.from({ length: count }, () => rollDie(6));
		}

		rolling = true;
		try {
			const results = await diceBox.roll(`${count}d6`, themeColor ? { themeColor } : undefined);
			return results.map((result) => result.value ?? 0);
		} finally {
			rolling = false;
		}
	}

	// End the turn: clear the dice, hand control to the parent (the CPU rival
	// takes its turn here), then auto-roll the player's dice once the rival is
	// done and the player's next turn begins.
	async function endTurn() {
		diceBox?.clear?.();
		total = null;
		rolled = false;

		await onEndTurn?.();

		roll();
	}
</script>

<div class="flex flex-col gap-1 p-2">
	<div class="flex items-center justify-between gap-3 border-b border-base-300 pb-1">
		<span class="badge badge-neutral gap-1">Turn {turnNumber}</span>
	</div>

	<div class="flex flex-col gap-2">
		<span class="text-xs font-semibold opacity-70">You</span>
		<div
			id={DICE_BOX_ID}
			class="relative aspect-square w-56 overflow-hidden rounded border border-base-300 bg-base-200/40"
		>
			{#if !ready}
				<div class="absolute inset-0 flex items-center justify-center text-xs opacity-50">
					<span class="loading loading-spinner loading-xs"></span>
				</div>
			{/if}

			<!-- Combat hit markers: one white result square (black number) per die that
			     scored a hit, stamped over the black combat dice at the roller. -->
			{#if combatHits && combatHits.length}
				<div
					class="pointer-events-none absolute inset-0 flex flex-wrap content-center items-center justify-center gap-1.5 p-3"
				>
					{#each combatHits as value, i (i)}
						<span
							class="flex h-9 w-9 items-center justify-center rounded-sm border border-base-300 bg-white text-base font-bold text-black shadow-md"
						>
							{value}
						</span>
					{/each}
				</div>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-2">
			<span class="badge badge-success w-full gap-1">
				You: {energyPoints}
				<span
					class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					aria-label="Energy"
					title="Energy"
				></span>
			</span>
			<span class="badge badge-info w-full gap-1">
				Rival: {rivalEnergy}
				<span
					class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					aria-label="Energy"
					title="Energy"
				></span>
			</span>
		</div>
	</div>

	<button
		class={classNames('btn btn-sm btn-block gap-1', unfolding ? 'btn-secondary' : 'btn-outline')}
		onclick={() => onUnfold?.()}
		disabled={rivalThinking || rolling || (!unfolding && energyPoints < UNFOLD_COST)}
	>
		{#if unfolding}
			Cancel Unfold
		{:else}
			Unfold ({UNFOLD_COST}
			<span
				class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
				aria-label="Energy"
				title="Energy"
			></span>)
		{/if}
	</button>

	<button
		class="btn btn-outline btn-sm btn-block"
		onclick={endTurn}
		disabled={!rolled || rolling || rivalThinking}
	>
		{#if rolling}
			<span class="loading loading-spinner loading-xs"></span>
			Rolling…
		{:else}
			End Turn
		{/if}
	</button>
</div>
