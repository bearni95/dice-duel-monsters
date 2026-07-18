<script lang="ts">
	import classNames from 'classnames';
	import type { CardDetail } from '$types/card.type';

	// Shows the entire available data for a single card. The parent controls
	// visibility by passing a card (open) or null (closed) and handles the fetch,
	// so this component stays purely presentational.
	let {
		card = null,
		loading = false,
		error = '',
		onClose
	}: {
		card: CardDetail | null;
		loading?: boolean;
		error?: string;
		onClose?: () => void;
	} = $props();

	const open = $derived(loading || Boolean(error) || Boolean(card));

	// Scalar fields shown as a labelled key/value grid. Empty values are skipped.
	const fields = $derived(
		card
			? [
					{ label: 'ID', value: card.id },
					{ label: 'Type', value: card.type },
					{ label: 'Human-readable type', value: card.humanReadableCardType },
					{ label: 'Frame type', value: card.frameType },
					{ label: 'Race', value: card.race },
					{ label: 'Attribute', value: card.attribute },
					{ label: 'Level', value: card.level },
					{ label: 'ATK', value: card.atk },
					{ label: 'DEF', value: card.def }
				].filter((f) => f.value !== undefined && f.value !== null && f.value !== '')
			: []
	);

	const image = $derived(card?.card_images?.[0]);

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose?.();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class={classNames('modal', 'modal-open')} role="dialog" aria-modal="true" aria-label="Card details">
		<div class="modal-box max-h-[90vh] w-11/12 max-w-3xl">
			<button
				class="btn btn-circle btn-ghost btn-sm absolute right-3 top-3"
				onclick={() => onClose?.()}
				aria-label="Close"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>

			{#if loading}
				<div class="flex justify-center py-20" aria-live="polite">
					<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading card"></span>
				</div>
			{:else if error}
				<div class="alert alert-error" role="alert">{error}</div>
			{:else if card}
				<h3 class="pr-8 text-xl font-bold">{card.name}</h3>
				{#if card.humanReadableCardType}
					<span class="badge badge-primary mt-1">{card.humanReadableCardType}</span>
				{/if}

				<div class="mt-4 flex flex-col gap-4 sm:flex-row">
					{#if image}
						<img
							class="mx-auto w-48 shrink-0 rounded-lg shadow-lg"
							src={image.image_url}
							alt={card.name}
							loading="lazy"
						/>
					{/if}

					<div class="min-w-0 flex-1">
						{#if card.typeline?.length}
							<div class="mb-3 flex flex-wrap gap-1">
								{#each card.typeline as t}
									<span class="badge badge-outline badge-sm">{t}</span>
								{/each}
							</div>
						{/if}

						<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
							{#each fields as field}
								<dt class="text-base-content/60 font-medium">{field.label}</dt>
								<dd class="break-words">{field.value}</dd>
							{/each}
						</dl>
					</div>
				</div>

				{#if card.desc}
					<div class="mt-4">
						<h4 class="text-base-content/60 mb-1 text-sm font-medium">Description</h4>
						<p class="bg-base-200 rounded-lg p-3 text-sm whitespace-pre-line">{card.desc}</p>
					</div>
				{/if}

				{#if card.card_prices?.[0]}
					<div class="mt-4">
						<h4 class="text-base-content/60 mb-1 text-sm font-medium">Prices</h4>
						<div class="overflow-x-auto">
							<table class="table table-xs">
								<tbody>
									{#each Object.entries(card.card_prices[0]) as [market, price]}
										<tr>
											<td class="capitalize">{market.replace(/_price$/, '').replace(/_/g, ' ')}</td>
											<td class="text-right">${price}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				{#if card.card_sets?.length}
					<div class="mt-4">
						<h4 class="text-base-content/60 mb-1 text-sm font-medium">
							Sets ({card.card_sets.length})
						</h4>
						<div class="max-h-48 overflow-y-auto overflow-x-auto">
							<table class="table table-xs table-pin-rows">
								<thead>
									<tr>
										<th>Set</th>
										<th>Code</th>
										<th>Rarity</th>
										<th class="text-right">Price</th>
									</tr>
								</thead>
								<tbody>
									{#each card.card_sets as set}
										<tr>
											<td>{set.set_name}</td>
											<td>{set.set_code}</td>
											<td>{set.set_rarity_code || set.set_rarity}</td>
											<td class="text-right">${set.set_price}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

				<div class="mt-4 flex flex-wrap items-center gap-3">
					{#if card.ygoprodeck_url}
						<a
							class="btn btn-outline btn-sm"
							href={card.ygoprodeck_url}
							target="_blank"
							rel="noopener noreferrer"
						>
							View on YGOPRODeck
						</a>
					{/if}
				</div>

				<details class="mt-4">
					<summary class="text-base-content/60 cursor-pointer text-sm font-medium">Raw data</summary>
					<pre class="bg-base-200 mt-2 max-h-64 overflow-auto rounded-lg p-3 text-xs">{JSON.stringify(
							card,
							null,
							2
						)}</pre>
				</details>
			{/if}
		</div>

		<button class="modal-backdrop" onclick={() => onClose?.()} aria-label="Close">close</button>
	</div>
{/if}
