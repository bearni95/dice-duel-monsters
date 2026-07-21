<script lang="ts">
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { enqueueCardGeneration } from '$utils/card/generateQueue';

	// Dev-only card tile for the /admin editors. The image is served by
	// GET /print?id=<id> from static/cards/generated. When that 404s (the card
	// hasn't been baked yet) the card is rendered once — client-side and throttled
	// (see generateQueue) — and POSTed to /print/save; on success the <img> is
	// reloaded and now resolves. If it still can't be produced, a "card not found"
	// placeholder is shown.
	//
	// This is the on-demand generator; the shipped product uses GeneratedCardImage,
	// which reads the committed PNG straight from /cards/generated and never touches
	// the /admin endpoints (they don't exist in a production build).
	let { card, name = card.name }: { card: CardAsset; name?: string } = $props();

	// Bumped after a successful generation to force the <img> to re-request the (now
	// existing) PNG, bypassing the browser's cached 404.
	let reloadToken = $state(0);
	// Set once generation has been attempted, so a second load failure falls through
	// to the placeholder instead of looping.
	let attempted = $state(false);
	let failed = $state(false);

	const src = $derived(`/print?id=${card.id}${reloadToken ? `&t=${reloadToken}` : ''}`);

	async function handleError() {
		if (attempted) {
			// Already tried to generate and it still won't load — give up on this card.
			failed = true;
			return;
		}
		attempted = true;
		try {
			await enqueueCardGeneration(card);
			reloadToken = Date.now();
		} catch {
			failed = true;
		}
	}
</script>

{#if failed}
	<div
		class="border-error/40 bg-base-100/60 text-base-content/60 flex aspect-[59/86] w-full items-center justify-center rounded border border-dashed p-2 text-center text-xs"
	>
		card not found
	</div>
{:else}
	<img
		{src}
		alt={name}
		loading="lazy"
		class="aspect-[59/86] w-full rounded object-contain"
		onerror={handleError}
	/>
{/if}
