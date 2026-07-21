<script lang="ts">
	// Game-over modal: shown the moment one origin core is destroyed. Reports who won
	// and the final heart tally of both origins, and offers a rematch. Presentation
	// only; the parent mounts it while the engine reports a decided match.
	import classNames from 'classnames';
	import type { GameOverResult } from '$types/board.type';

	let { result, originLp }: { result: GameOverResult; originLp: number } = $props();
</script>

<div class="modal modal-open z-30">
	<div class="modal-box max-w-md text-center">
		<div
			class={classNames('text-3xl font-black tracking-wide', {
				'text-success': result.winner === 'player',
				'text-error': result.winner === 'cpu'
			})}
		>
			{result.winner === 'player' ? 'Victory!' : 'Defeat'}
		</div>

		<p class="mt-2 text-sm text-base-content/70">
			{result.winner === 'player'
				? 'You destroyed the rival network core.'
				: 'The rival destroyed your network core.'}
		</p>

		<div class="mt-5 flex items-stretch justify-center gap-3">
			<div
				class={classNames('flex-1 rounded-lg border p-3', {
					'border-success bg-success/10': result.winner === 'player',
					'border-base-300 bg-base-200': result.winner !== 'player'
				})}
			>
				<div class="text-xs font-semibold uppercase opacity-70">You</div>
				<div class="mt-1 text-2xl font-bold text-error">
					{'❤'.repeat(result.playerLp) || '—'}
				</div>
				<div class="text-xs opacity-60">{result.playerLp} / {originLp} hearts</div>
			</div>

			<div class="flex items-center text-lg font-bold opacity-50">vs</div>

			<div
				class={classNames('flex-1 rounded-lg border p-3', {
					'border-success bg-success/10': result.winner === 'cpu',
					'border-base-300 bg-base-200': result.winner !== 'cpu'
				})}
			>
				<div class="text-xs font-semibold uppercase opacity-70">Rival</div>
				<div class="mt-1 text-2xl font-bold text-info">
					{'❤'.repeat(result.rivalLp) || '—'}
				</div>
				<div class="text-xs opacity-60">{result.rivalLp} / {originLp} hearts</div>
			</div>
		</div>

		<div class="modal-action justify-center">
			<button class="btn btn-primary" onclick={() => location.reload()}>Play Again</button>
		</div>
	</div>
	<div class="modal-backdrop bg-black/60"></div>
</div>
