<script lang="ts">
	// The drawn-hand tray: a header with the hand/deck counts, the sort controls (one
	// cell per creature attribute, cycling asc → desc → off), and the hand card grid.
	// Clicking a card inspects it (loading it into the detail cell above); the Select
	// overlay flags it for summoning. UI only — all state and commands come from the
	// board engine passed in as the view-model.
	import classNames from 'classnames';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import type { BoardEngine } from '$services/board-engine.svelte';

	let { engine }: { engine: BoardEngine } = $props();
</script>

<div class="divider my-0"></div>

<!-- Hand header: the drawn hand's count and the remaining draw pile. The deck is shown
     as a count only — its cards are drawn into the hand at each turn start. -->
<div class="flex items-center justify-between px-1">
	<span class="text-xs font-semibold tracking-wide uppercase opacity-60">
		Hand ({engine.hand.length}/{engine.HAND_SIZE})
	</span>
	<span class="badge badge-neutral badge-sm gap-1">Deck: {engine.deck.length}</span>
</div>

<!-- Sort controls: one cell per creature attribute. The active sort column is
     highlighted; clicking cycles asc → desc → off. -->
<div class="grid grid-cols-5 gap-1">
	{#each engine.sortColumns as col (col.key)}
		<button
			class={classNames('btn btn-xs gap-0.5', {
				'btn-primary': engine.sortKey === col.key,
				'btn-ghost bg-base-100': engine.sortKey !== col.key
			})}
			onclick={() => engine.toggleSort(col.key)}
		>
			<span>{col.label}</span>
			{#if engine.sortKey === col.key}
				<span class="text-[10px]">{engine.sortDir === 'asc' ? '▲' : '▼'}</span>
			{/if}
		</button>
	{/each}
</div>

<div class="grid grid-cols-2 gap-1">
	{#each engine.handCards as card (card.id)}
		<!-- Cards too costly to summon right now are shown dimmed and desaturated, with
		     their Select disabled, rather than hidden from the hand. Clicking anywhere on
		     the card loads it into the detail panel above (inspect-only for hand cards);
		     the Select overlay still summons it. -->
		<div
			class={classNames('group relative cursor-pointer transition', {
				'opacity-50 grayscale': !engine.canSummon(card)
			})}
			role="button"
			tabindex="0"
			onclick={() => engine.inspectCard(card)}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					engine.inspectCard(card);
				}
			}}
		>
			<GeneratedCardImage id={card.id} name={card.name} />
			<!-- Darkening layer + Select button covering the whole card, hidden until the
			     card is hovered, then fading in together. -->
			<div
				class="absolute inset-0 z-20 bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
			></div>
			<div
				class="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
			>
				<button
					class="btn btn-sm btn-primary"
					disabled={engine.summoning ||
						engine.moving ||
						engine.combating ||
						!!engine.specialPhase ||
						!engine.canSummon(card)}
					onclick={() => engine.selectMonster(card)}
				>
					{engine.selectedMonster?.id === card.id || engine.specialSummonCard?.id === card.id
						? 'Selected'
						: 'Select'}
				</button>
			</div>
		</div>
	{/each}

	{#if !engine.handCards.length}
		<div
			class="col-span-2 flex items-center justify-center rounded border border-dashed border-base-300 bg-base-100/60 p-4 text-center text-sm text-base-content/60"
		>
			{engine.deck.length
				? 'Cards will be drawn at the start of your turn.'
				: 'Your deck is empty.'}
		</div>
	{/if}
</div>
