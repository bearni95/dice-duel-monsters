<script lang="ts">
	// The floating combat toast: the attacker → target line and each rolled die, with
	// hits (dice at/above the target's defense) highlighted, plus the hit tally. Pinned
	// below the navbar. Presentation only; the parent mounts it while the engine has a
	// recent combat result.
	import classNames from 'classnames';
	import type { CombatResult } from '$types/board.type';

	let { result }: { result: CombatResult } = $props();
</script>

<div class="fixed top-[calc(var(--navbar-h)+3rem)] left-1/2 z-20 -translate-x-1/2">
	<div class="rounded border border-base-300 bg-base-100 px-4 py-2 shadow-lg">
		<div class="text-sm font-semibold">
			{result.attacker} → {result.target}
		</div>
		<div class="mt-1 flex items-center gap-1">
			{#each result.rolls as roll, i (i)}
				<span
					class={classNames(
						'flex h-6 w-6 items-center justify-center rounded border text-xs font-semibold',
						roll >= result.threshold
							? 'border-success bg-success text-success-content'
							: 'border-base-300 bg-base-200 text-base-content/50'
					)}
				>
					{roll}
				</span>
			{/each}
			<span class="ml-2 text-xs opacity-80">
				{result.hits} hit{result.hits === 1 ? '' : 's'} · needs {result.threshold}+
			</span>
		</div>
	</div>
</div>
