<script lang="ts">
	import type { IGameCreature } from "$adapters/creature.adapter";

	export type CardAsset = {
		id: number;
		name: string;
		type: string;
		race: string;
		attribute: string;
		cardImages: { image_url_cropped: string }[];
		billboard?: string
		atk?: number
		def?: number
		lvl?: number
	};

	

	let { card }: { card: IGameCreature } = $props();

	console.log({card})
</script>

<article class="card border border-base-300 bg-base-100 shadow-sm">
	<div class="card-body gap-3 p-4">
		<div>
			<h2 class="text-base font-semibold" title={card.name}>{card.name}</h2>
			<p class="text-sm text-base-content/60">Card ID: {card.id}</p>
		</div>

		<div class="grid items-start gap-3">
			<figure>
				<img
					class="h-auto w-full rounded"
					src={card.cardImages?.[0]?.image_url_cropped}
					alt={`${card.name}`}
					loading="lazy"
				/>
			</figure>
		</div>
		<div>
		<div>Cost: {card.cost}</div>

		<table class="table table-zebra">
		<thead>
			<tr>
				<th>Atk</th>
				<th>Def</th>
				<th>HP</th>
				<th>SPD</th>
			</tr></thead>
			<tbody>
			<tr>
				<td>{card.atk}d6</td>
				<td>{card.def}+</td>
				<td>{card.hp}</td>
				<td>{card.speed}</td>
			</tr></tbody>
		</table>
	</div>
</article>
