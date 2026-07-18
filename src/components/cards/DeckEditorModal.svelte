<script lang="ts">
	import classNames from 'classnames';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import CardTile from '$components/cards/CardTile.svelte';
	import { saveDeck } from '$services/deck.service';
	import type { Deck } from '$types/deck.type';

	// Deck editor. The parent controls visibility by passing a deck (open) or null
	// (closed). Shows every card in the deck as a grid, mirroring the home page
	// preview, but unlike that view it renders *all* the deck's cards — the ones the
	// home page hides because they aren't playable (non-vanilla monsters, or
	// spell/traps without an assigned effect) show here dimmed and non-interactive
	// so the whole deck list stays visible.
	//
	// Each playable card also carries an enable/disable toggle (enabled by
	// default). Disabling a card records its id in the deck's `disabled` list —
	// persisted to the deck's static JSON — which drops it from the playable views
	// (the home-page preview and the board's summonable pool) without removing it
	// from the deck.
	let {
		deck = null,
		onClose
	}: {
		deck: Deck | null;
		onClose?: () => void;
	} = $props();

	const cardApiAdapter = new CardApiAdapter();

	let cards = $state<Array<{ card: import('$components/cards/GameCard.svelte').CardAsset; playable: boolean }>>([]);
	let loading = $state(false);
	let loadError = $state('');
	let loadedDeckId = $state<string | null>(null);

	// The deck's disabled and forced card ids, held locally as the source of truth
	// for the toggles so rapid clicks stay consistent regardless of when the deck
	// store (and the `deck` prop) refresh. `disabled` turns a playable card off;
	// `forced` turns a not-playable card on. Both initialized when the deck loads.
	let disabledIds = $state<Set<number>>(new Set());
	let forcedIds = $state<Set<number>>(new Set());
	// Card ids with a persist request in flight, to disable their toggle briefly.
	let savingIds = $state<Set<number>>(new Set());
	let saveError = $state('');

	const open = $derived(Boolean(deck));
	// Whether a card reaches the home/board views: a playable card that isn't
	// disabled, or a not-playable card that's been forced on.
	function isEnabled(entry: { card: { id: number }; playable: boolean }): boolean {
		return entry.playable ? !disabledIds.has(entry.card.id) : forcedIds.has(entry.card.id);
	}
	const enabledCount = $derived(cards.filter(isEnabled).length);
	const forcedCount = $derived(cards.filter((c) => !c.playable && forcedIds.has(c.card.id)).length);

	// (Re)load whenever a different deck is opened.
	$effect(() => {
		if (deck && deck.id !== loadedDeckId) {
			loadedDeckId = deck.id;
			load(deck);
		}
		if (!deck) {
			loadedDeckId = null;
		}
	});

	async function load(d: Deck) {
		loading = true;
		loadError = '';
		saveError = '';
		cards = [];
		disabledIds = new Set(d.disabled ?? []);
		forcedIds = new Set(d.forced ?? []);
		try {
			const ids = [...d.main, ...d.extra, ...d.side];
			cards = await cardApiAdapter.loadDeckEditorCards(ids);
		} catch (error) {
			loadError = error instanceof Error ? error.message : 'Could not load deck cards.';
		} finally {
			loading = false;
		}
	}

	// Flip a card's enabled state and persist the deck's full disabled/forced lists.
	// A playable card toggles its `disabled` membership; a not-playable card toggles
	// its `forced` membership. The local sets are authoritative, so we write them
	// wholesale rather than re-deriving from the possibly-stale `deck` prop.
	async function toggleCard(entry: { card: { id: number }; playable: boolean }) {
		const cardId = entry.card.id;
		if (!deck || savingIds.has(cardId)) return;

		const prevDisabled = disabledIds;
		const prevForced = forcedIds;
		const nextDisabled = new Set(disabledIds);
		const nextForced = new Set(forcedIds);

		if (entry.playable) {
			if (nextDisabled.has(cardId)) nextDisabled.delete(cardId);
			else nextDisabled.add(cardId);
		} else {
			if (nextForced.has(cardId)) nextForced.delete(cardId);
			else nextForced.add(cardId);
		}

		// Optimistic update so the toggle responds instantly.
		disabledIds = nextDisabled;
		forcedIds = nextForced;
		savingIds = new Set(savingIds).add(cardId);
		saveError = '';

		try {
			await saveDeck({
				id: deck.id,
				name: deck.name,
				main: deck.main,
				extra: deck.extra,
				side: deck.side,
				disabled: [...nextDisabled],
				forced: [...nextForced]
			});
		} catch (error) {
			// Roll the toggle back so the UI reflects what's actually persisted.
			disabledIds = prevDisabled;
			forcedIds = prevForced;
			saveError = error instanceof Error ? error.message : 'Could not save the change.';
		} finally {
			const done = new Set(savingIds);
			done.delete(cardId);
			savingIds = done;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && deck}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label="Deck editor">
		<div class="modal-box max-h-[90vh] w-11/12 max-w-6xl">
			<button
				class="btn btn-circle btn-ghost btn-sm absolute top-3 right-3"
				onclick={() => onClose?.()}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			<header class="pr-8">
				<h3 class="text-xl font-bold">{deck.name}</h3>
				<p class="text-base-content/60 text-sm">
					{cards.length} cards
					<span class="text-base-content/40">
						· {enabledCount} in play · {cards.length - enabledCount} hidden
						{#if forcedCount}· {forcedCount} forced on{/if}
					</span>
				</p>
				{#if saveError}
					<span class="text-error text-xs">{saveError}</span>
				{/if}
			</header>

			{#if loading}
				<div class="flex justify-center py-20" aria-live="polite">
					<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading deck"></span>
				</div>
			{:else if loadError}
				<div class="alert alert-error mt-4" role="alert">{loadError}</div>
			{:else if !cards.length}
				<p class="text-base-content/50 py-8 text-sm">None of this deck's cards are in the local card database.</p>
			{:else}
				<div class="mt-4 flex flex-wrap gap-4">
					{#each cards as entry, i (`${deck.id}-${entry.card.id}-${i}`)}
						{@const forced = !entry.playable && forcedIds.has(entry.card.id)}
						{@const enabled = isEnabled(entry)}
						<div class="relative flex w-[180px] flex-col gap-2">
							<div
								class={classNames({
									'pointer-events-none opacity-40 grayscale': !enabled
								})}
							>
								<CardTile card={entry.card} />
							</div>
							{#if !entry.playable && !forced}
								<span class="badge badge-neutral badge-sm absolute top-1 left-1">Not playable</span>
							{:else if forced}
								<span class="badge badge-info badge-sm absolute top-1 left-1">Forced</span>
							{:else if !enabled}
								<span class="badge badge-warning badge-sm absolute top-1 left-1">Off</span>
							{/if}

							<!-- Per-card toggle. A playable card toggles enabled/disabled (on by
							     default); a not-playable card toggles force-on (off by default),
							     letting the owner override the app's playable verdict for this deck.
							     Either way it controls whether the card reaches the home preview and
							     the board's summonable pool. -->
							<label class="label cursor-pointer justify-start gap-2 py-0">
								<input
									type="checkbox"
									class={classNames('toggle toggle-sm', {
										'toggle-primary': entry.playable,
										'toggle-info': !entry.playable
									})}
									checked={enabled}
									disabled={savingIds.has(entry.card.id)}
									onchange={() => toggleCard(entry)}
								/>
								<span class="label-text text-xs">
									{#if entry.playable}
										{enabled ? 'Enabled' : 'Disabled'}
									{:else}
										{forced ? 'Forced on' : 'Force enable'}
									{/if}
								</span>
							</label>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<button class="modal-backdrop" onclick={() => onClose?.()} aria-label="Close">close</button>
	</div>
{/if}
