<script lang="ts">
	// Renders a card as its pre-generated PNG rather than the live DOM renderer
	// (GameCard). The bitmaps are baked by the /admin tooling and committed under
	// static/cards/generated/<id>.png, served as a plain static asset at
	// /cards/generated/<id>.png — so this works in the shipped product, where the
	// /admin generation endpoints don't exist. When the file is missing the image
	// fails to load and a "card not found" placeholder is shown in its place.
	let { id, name = '' }: { id: number; name?: string } = $props();

	// Flipped once the PNG fails to load (typically a 404 for a card that was never
	// baked), swapping the art for the placeholder.
	let failed = $state(false);
</script>

{#if failed}
	<div
		class="border-error/40 bg-base-100/60 text-base-content/60 flex aspect-[1080/1415] w-full items-center justify-center rounded border border-dashed p-2 text-center text-xs"
	>
		card not found
	</div>
{:else}
	<img
		src={`/cards/generated/${id}.png`}
		alt={name}
		loading="lazy"
		class="block w-full rounded"
		onerror={() => (failed = true)}
	/>
{/if}
