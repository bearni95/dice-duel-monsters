<script lang="ts">
	import classNames from 'classnames';
	import BoosterPackOpener from './BoosterPackOpener.svelte';
	import { defaultBoosterPack } from '$data/boosterPacks';
	import { openPack } from '$utils/booster/rarityTier';
	import { packCoverUrl } from '$utils/booster/packTextures';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import type { PackPull } from '$types/booster.type';

	/**
	 * A whole pack-opening session: the canvas a pack is sliced open in, and the
	 * button that rolls the next one. It owns the pack's own state — what was
	 * pulled, whether it has been cut open, whether the grant is in flight — so a
	 * page can drop it in and only supply the pool to draw from and somewhere to
	 * put the cards.
	 *
	 * It fills whatever box it is given, canvas taking the space the button
	 * doesn't.
	 */
	let {
		pool = [],
		saving = false,
		onGrant,
		classes = ''
	}: {
		/** The cards a pack can yield. A pack rolls as soon as this arrives. */
		pool?: CardAsset[];
		/** Set while a write the page owns is in flight; blocks the next pack. */
		saving?: boolean;
		/** Persists the pulls once they have settled. Rejecting reports on the panel. */
		onGrant?: (cardIds: number[]) => Promise<void>;
		classes?: string;
	} = $props();

	const pack = defaultBoosterPack;

	// The pack's cover art, resolved from the pool so it can only ever point at a
	// card whose art actually ships. Falls back to the first card in the pool when
	// the configured cover isn't in it.
	let coverUrl = $derived.by(() => {
		if (!pool.length) return null;
		const cover = pool.find((card) => card.id === pack.coverCardId) ?? pool[0];
		return packCoverUrl(cover);
	});

	let pulls = $state<PackPull[]>([]);
	// Bumped on every roll so the canvas remounts with a fresh wrapper rather than
	// trying to re-animate the one that was just cut.
	let openSession = $state(0);
	// The grant is deferred until the cut animation finishes, so a pack left
	// unopened costs nothing. `opened` flips when it does, and is what gates
	// rolling the next pack — it tracks the animation rather than the write, so a
	// grant that fails leaves the player able to move on rather than stuck on a
	// pack that can never be re-committed.
	let opened = $state(false);
	let committing = $state(false);
	let error = $state('');

	let ready = $derived(pool.length > 0 && pulls.length > 0);

	// Which pool the panel has already rolled against. A plain variable rather than
	// state: it exists so the effect below fires once per pool it is handed, and
	// writing it must not re-run anything.
	let rolledFor: CardAsset[] | null = null;

	// The pool is fetched by the page, so it arrives after the first render — the
	// opening pack is rolled when it does.
	$effect(() => {
		if (pool.length > 0 && rolledFor !== pool) {
			rolledFor = pool;
			roll();
		}
	});

	// Roll the next pack. The pulls are decided here rather than at the cut, so the
	// scene can warm their art while the player is still aiming.
	function roll() {
		if (!pool.length) return;
		error = '';
		pulls = openPack(pool);
		opened = false;
		openSession += 1;
	}

	// Fires once the cards have settled in the canvas: that is the moment they
	// become the player's, so it is the moment they are handed over to be kept.
	async function commit() {
		if (opened || committing || pulls.length === 0) return;
		opened = true;
		committing = true;
		try {
			await onGrant?.(pulls.map((pull) => pull.card.id));
		} catch {
			error = "Those cards couldn't be added to your collection. Try opening another pack.";
		} finally {
			committing = false;
		}
	}
</script>

<div class={classNames('flex min-h-0 flex-col', classes)}>
	{#if ready}
		<div class="min-h-0 flex-1">
			{#key openSession}
				<BoosterPackOpener {pack} {coverUrl} {pulls} onOpenComplete={commit} />
			{/key}
		</div>

		<footer class="z-20 flex shrink-0 flex-col items-center gap-2 p-4">
			<!-- Only ever on screen when a grant failed, over the collection backdrop
			     the layout draws — hence the panel rather than bare text on the art. -->
			{#if error}
				<p
					class="bg-base-100/70 border-base-300/60 text-error rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-sm"
					role="alert"
				>
					{error}
				</p>
			{/if}

			<!-- `btn-warning` rather than `bg-warning text-warning-content`: DaisyUI
			     puts its disabled styling inside `@layer daisyui`, so a plain colour
			     utility (which lands in the later `utilities` layer) wins the cascade
			     and paints the button its live colour even while it is disabled. -->
			<button class="btn btn-warning" disabled={!opened || committing || saving} onclick={roll}>
				Open another
			</button>
		</footer>
	{:else}
		<section class="m-auto space-y-2 p-4 text-center" aria-label="Nothing to open">
			<p class="text-base-content/60 text-sm">No cards are available to pack yet.</p>
		</section>
	{/if}
</div>
