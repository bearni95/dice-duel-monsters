<script lang="ts">
	// The left-panel combat card: shown while a recent attack is resolving. Reads the
	// attacker, an arrow, and the defender in a row — with the attacker's ATK, the
	// defender's DEF, and the HP inflicted by the roll. Pure presentation; the parent
	// decides when to mount it (the board engine owns the combatResult state).
	import type { CombatResult } from '$types/board.type';

	let { result }: { result: CombatResult } = $props();
</script>

<div class="w-56 rounded border bg-base-100 p-3 shadow-lg">
	<div class="mb-2 text-xs font-semibold tracking-wide uppercase opacity-60">Combat</div>

	<div class="flex items-center justify-between gap-1">
		<div class="flex flex-1 flex-col items-center gap-1 text-center">
			<div
				class="flex aspect-square w-14 items-center justify-center overflow-hidden rounded border border-base-300 bg-base-200"
			>
				{#if result.attackerArt}
					<img
						src={result.attackerArt}
						alt={result.attacker}
						class="h-full w-full object-cover"
					/>
				{:else}
					<span class="text-lg opacity-40">?</span>
				{/if}
			</div>
			<span class="line-clamp-2 text-xs font-semibold">{result.attacker}</span>
			<span class="badge badge-error badge-sm gap-1">ATK {result.rolls.length}</span>
		</div>

		<div class="text-2xl leading-none opacity-70">→</div>

		<div class="flex flex-1 flex-col items-center gap-1 text-center">
			<div
				class="flex aspect-square w-14 items-center justify-center overflow-hidden rounded border border-base-300 bg-base-200"
			>
				{#if result.targetArt}
					<img
						src={result.targetArt}
						alt={result.target}
						class="h-full w-full object-cover"
					/>
				{:else}
					<span class="text-lg opacity-40">⌂</span>
				{/if}
			</div>
			<span class="line-clamp-2 text-xs font-semibold">{result.target}</span>
			<span class="badge badge-info badge-sm gap-1">DEF {result.threshold}</span>
		</div>
	</div>

	<div class="mt-3 flex items-center justify-center gap-2 border-t border-base-300 pt-2">
		<span class="text-xs opacity-70">HP inflicted</span>
		<span class="badge badge-success badge-sm font-bold">{result.hits}</span>
	</div>
</div>
