<script lang="ts">
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import type { IGameCreature } from "$adapters/creature.adapter";
	import { textureForType } from "$utils/card/typeTexture";
	import { effectsService } from "$services/effect.service";
	import { effectAdapter } from "$adapters/effect.adapter";
	import { cardEffects, ensureCardEffects } from "$services/card-effects.service";
	import type { CardEffect } from "$types/effect.type";
	import type { CardEffectImplementation } from "$types/card-effect.type";

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



	// `showStats` gates the in-game stat overlays (cost/HP/atk/def/speed/reach),
	// which only apply to monsters. Non-monster cards (spells, traps, …) render
	// through the same framed art with the overlays hidden.
	let {
		card,
		overlay,
		showStats = true
	}: { card: IGameCreature; overlay?: Snippet; showStats?: boolean } = $props();

	// Spell and trap cards fade in a preview of their linked effects on hover. The
	// data comes from the same services the /admin/cards editor writes to, so any
	// card rendered anywhere through GameCard shows its effects without the parent
	// wiring anything up. Both stores are mirrored into local state so the overlay
	// stays reactive to edits.
	let templates = $state<CardEffect[]>(effectsService.all());
	effectsService.store.subscribe((v) => (templates = v));

	let effectsMap = $state<Record<string, CardEffectImplementation[]>>({});
	cardEffects.subscribe((v) => (effectsMap = v));

	const isSpellOrTrap = $derived.by(() => {
		const type = (card.type ?? '').toLowerCase();
		return type.includes('spell') || type.includes('trap');
	});

	// Each linked effect resolved to what the overlay shows: the template name and
	// kind, its human-readable description, and every templated param with the
	// value this card supplies (falling back to the param's default).
	const effectViews = $derived.by(() =>
		(effectsMap[String(card.id)] ?? []).map((impl) => {
			const template = templates.find((t) => String(t.id) === String(impl.effectId));
			return {
				id: impl.id,
				name: template?.name ?? 'Unknown effect',
				kind: template?.kind ?? '',
				text: template
					? effectAdapter.toDisplayText(template, impl.values)
					: 'Effect template missing',
				params: template
					? effectAdapter.templatedParams(template).map((param) => ({
							key: param.key,
							label: param.label,
							value: impl.values[param.key] ?? param.defaultValue
						}))
					: []
			};
		})
	);

	const showEffectsOverlay = $derived(isSpellOrTrap && effectViews.length > 0);

	// Load the linked-effects map once (guarded by the service's own flag) so the
	// overlay works wherever a card renders, without the parent wiring it up.
	onMount(ensureCardEffects);
</script>

<article class="group card relative aspect-square overflow-hidden border-[5px] border-black/50 bg-base-100">
	<!-- Type-matched background texture (Normal, Effect, Ritual, Synchro, Xyz,
	     Link, …), tinting the whole card frame behind its content. -->
	<img
		src={textureForType(card.type)}
		alt=""
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 h-full max-h-none w-full max-w-none object-cover object-center"
	/>

	<div class="card-body relative flex-1 gap-3 p-2 text-sm text-black">
		<div class="min-h-0 flex-1">
			<figure class="group relative h-full">
				<img
					class="h-full w-full rounded object-cover"
					src={card.cardImages?.[0]?.image_url_cropped}
					alt={`${card.name}`}
					loading="lazy"
				/>

				{#if showStats}
				<div
					class="absolute top-1 left-1 z-10 flex flex-col items-center text-center text-sm text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
					title="Cost"
					aria-label="Cost"
				>
					<span
						class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					></span>
					<span>{card.cost}</span>
				</div>

				<div
					class="absolute top-1 right-1 z-10 flex flex-col items-center text-center text-sm text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
					title="HP"
					aria-label="HP"
				>
					<span
						class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/skoll/hearts.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					></span>
					<span>{card.hp}d6</span>
				</div>

				<div
					class="absolute right-1 bottom-1 left-1 z-10 grid grid-cols-4 gap-2 text-center text-sm text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
				>
					<div>
						<div class="flex justify-center font-bold" title="Atk" aria-label="Atk">
							<span
								class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/lorc/broadsword.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
							></span>
						</div>
						<div>{card.atk}d6</div>
					</div>
					<div>
						<div class="flex justify-center font-bold" title="Def" aria-label="Def">
							<span
								class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/lorc/edged-shield.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
							></span>
						</div>
						<div>{card.def}+</div>
					</div>
					<div>
						<div class="flex justify-center font-bold" title="SPD" aria-label="SPD">
							<span
								class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/lorc/walking-boot.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
							></span>
						</div>
						<div>{card.speed}</div>
					</div>
					<div>
						<div class="flex justify-center font-bold" title="Reach" aria-label="Reach">
							<span
								class="block h-6 w-6 bg-current [mask-image:url(/assets/icons/lorc/arrowhead.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
							></span>
						</div>
						<div>{card.reach}</div>
					</div>
				</div>
				{/if}
			</figure>
		</div>
	</div>

	{#if overlay}
		<!-- Darkening layer + Select button covering the whole card, hidden until the
		     card is hovered, then fading in/out together. -->
		<div
			class="absolute inset-0 z-20 bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
		></div>
		<div
			class="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
		>
			{@render overlay()}
		</div>
	{/if}

	{#if showEffectsOverlay}
		<!-- Slight scrim + linked-effects list for spell/trap cards, hidden until the
		     card is hovered, then fading in. -->
		<div
			class="pointer-events-none absolute inset-0 z-30 flex flex-col gap-2 overflow-y-auto bg-black/60 p-3 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
		>
			<h3 class="text-xs font-bold tracking-wide uppercase text-white/70">Effects</h3>
			{#each effectViews as view (view.id)}
				<div class="rounded bg-white/10 p-2">
					<div class="flex items-center gap-2">
						<span class="text-xs font-semibold">{view.name}</span>
						{#if view.kind}
							<span class="badge badge-outline badge-xs text-white/70">{view.kind}</span>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-white/80">{view.text}</p>
					{#if view.params.length}
						<dl class="mt-1 flex flex-col gap-0.5 text-[11px]">
							{#each view.params as param (param.key)}
								<div class="flex justify-between gap-2">
									<dt class="text-white/60">{param.label}</dt>
									<dd class="font-medium">{param.value}</dd>
								</div>
							{/each}
						</dl>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</article>
