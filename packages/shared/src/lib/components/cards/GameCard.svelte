<script lang="ts">
	import type { Snippet } from "svelte";
	import { onMount } from "svelte";
	import type { IGameCreature } from "$adapters/creature.adapter";
	import { textureForType } from "$utils/card/typeTexture";
	import { attributeIcon } from "$utils/card/attributeIcon";
	import { typeIcon } from "$utils/card/typeIcon";
	import { effectsService } from "$services/effect.service";
	import { effectAdapter } from "$adapters/effect.adapter";
	import { cardEffects, ensureCardEffects } from "$services/card-effects.service";
	import { spells, ensureSpells } from "$services/spell.service";
	import type { CardEffect } from "$types/effect.type";
	import type { CardEffectImplementation } from "$types/card-effect.type";
	import type { SpellDefinition } from "$types/spell.type";

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
		// Board size factor for the billboard (1 = default, red and purple borders
		// matching), plus the x/y pixel offset of the image (its red square) relative
		// to its cell (the purple square). Only set when adjusted in the board-preview
		// modal.
		size?: number
		x?: number
		y?: number
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
	// data comes from the same services the /cards editor writes to, so any
	// card rendered anywhere through GameCard shows its effects without the parent
	// wiring anything up. Both stores are mirrored into local state so the overlay
	// stays reactive to edits.
	let templates = $state<CardEffect[]>(effectsService.all());
	effectsService.store.subscribe((v) => (templates = v));

	let effectsMap = $state<Record<string, CardEffectImplementation[]>>({});
	cardEffects.subscribe((v) => (effectsMap = v));

	// The six board spells (see /spells), mirrored so a card that represents a spell
	// can print that spell's effect text at its bottom. A spell is linked to a
	// magic/trap card by id on the /spells page.
	let spellList = $state<SpellDefinition[]>([]);
	spells.subscribe((v) => (spellList = v));

	// The spell this card visually represents, if any — matched by the spell's
	// associated card id. Its description is rendered as the card's bottom text.
	const spellForCard = $derived(spellList.find((s) => s.card?.id === card.id) ?? null);

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

	// The card's attribute icon (Dark, Fire, Water, …), shown in the top row of the
	// stat overlay. Null when the card has no recognized attribute (many spells and
	// traps), in which case the icon is simply omitted.
	const attributeIconUrl = $derived(attributeIcon(card.attribute));

	// The card's monster-type icon (Master Duel type icon for Dragon, Warrior, …),
	// shown in place of the race text at the bottom edge. Null when the race isn't a
	// known monster type (spells, traps, character cards), in which case the plain
	// race text is rendered instead.
	const typeIconUrl = $derived(typeIcon(card.race));

	// The type name split into the lines the type badge renders. Hyphenated types
	// break at the dash (e.g. "Beast-Warrior" → "Beast" / "Warrior"), "Winged Beast"
	// breaks at the space ("Winged" / "Beast"), and Spellcaster is split as
	// "Spell" / "caster"; everything else stays a single line.
	const typeLines = $derived.by(() => {
		const race = card.race ?? '';
		if (race.toLowerCase() === 'spellcaster') return ['Spell', 'caster'];
		if (race.toLowerCase() === 'winged beast') return ['Winged', 'Beast'];
		return race.split('-');
	});

	// Load the linked-effects map once (guarded by the service's own flag) so the
	// overlay works wherever a card renders, without the parent wiring it up.
	onMount(() => {
		ensureCardEffects();
		ensureSpells();
	});
</script>

<!-- One stat laid out horizontally — icon on the left, value on the right — for the
     4-column row under the card art. Same masked-icon / white drop-shadow treatment. -->
{#snippet statRow(label: string, maskClass: string, value: string | number)}
	<div
		class="flex items-center justify-center gap-1 rounded bg-white/50 px-1 py-[2px] text-white"
		title={label}
		aria-label={label}
	>
		<!-- The drop-shadow lives on this unmasked wrapper, not on the masked icon span
			 below: a filter on the same element as a mask gets clipped away by that mask
			 (mask is applied after the filter), so the shadow only shows when cast from an
			 unmasked ancestor. -->
		<span class="block shrink-0 [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]">
			<span
				class={`block h-[18px] w-[18px] bg-white [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] ${maskClass}`}
			></span>
		</span>
		<span
			class="text-center text-[15px] leading-none font-bold [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
		>{value}</span>
	</div>
{/snippet}

<article class="group card relative overflow-hidden border-[5px] border-black/50 bg-base-100">
	<!-- Type-matched background texture (Normal, Effect, Ritual, Synchro, Xyz,
	     Link, …), tinting the whole card frame behind its content. -->
	<img
		src={textureForType(card.type)}
		alt=""
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 h-full max-h-none w-full max-w-none object-cover object-center"
	/>

	<!-- The card art with a stat bar above and below it. Each bar is a 4-column grid
	     of stat cells; the art fills the space between them. On non-monster cards
	     (showStats = false) the bars are dropped and the art fills the whole frame. -->
	<div class="relative z-10 flex w-full flex-col gap-1 p-1">
		<!-- Name row: the cost badge on the left end and the HP badge on the right end,
		     with the card's name centered between them. Each badge is the same icon-with-
		     value-overlaid treatment used on the art, sized 24px with a 14px black value. -->
		<div
			class="flex items-center gap-1 rounded bg-white/50 px-1 py-[2px] text-white"
		>
			{#if showStats}
				<!-- Cost badge: the empty-battery icon with the cost value overlaid inside it. -->
				<div class="relative h-6 w-6 shrink-0 [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]" title="Cost" aria-label="Cost">
					<span
						class="relative z-0 block h-full w-full bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					></span>
					<span
						class="absolute inset-0 z-10 flex items-center justify-center text-[14px] leading-none font-bold text-black [filter:none]"
					>
						{card.cost}
					</span>
				</div>
			{/if}
			<span class="min-w-0 flex-1 line-clamp-2 text-center text-[11px] leading-tight font-bold [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]">
				{card.name}
			</span>
			{#if showStats}
				<!-- HP badge: the hearts icon with the HP dice count overlaid inside it. -->
				<div class="relative h-6 w-6 shrink-0 [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]" title="HP" aria-label="HP">
					<span
						class="relative z-0 block h-full w-full bg-current [mask-image:url(/assets/icons/skoll/hearts.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
					></span>
					<span
						class="absolute inset-0 z-10 flex items-center justify-center text-[14px] leading-none font-bold text-black [filter:none]"
					>
						{card.hp}
					</span>
				</div>
			{/if}
		</div>

		<!-- The card art in its blue-bordered frame: a full-width square. object-contain
		     shows the whole image without cropping. -->
		<div class="flex items-stretch gap-1 rounded border border-black">
			<figure class="relative aspect-square min-w-0 flex-1 overflow-hidden rounded-[3px]">
				<img
					class="h-full w-full object-contain"
					src={card.cardImages?.[0]?.image_url_cropped}
					alt={`${card.name}`}
					loading="lazy"
				/>
				{#if showStats}
					<!-- Attribute badge: its text above the attribute icon, pinned to the
						 bottom-left of the art. -->
					<div
						class="absolute bottom-1 left-1 z-20 flex flex-col items-start gap-0.5 text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
						title="Attribute"
						aria-label="Attribute"
					>
						<span class="text-center text-[10px] leading-tight font-semibold tracking-wide uppercase">
							{card.attribute}
						</span>
						{#if attributeIconUrl}
							<img src={attributeIconUrl} alt="" aria-hidden="true" class="h-[18px] w-[18px] object-contain" />
						{/if}
					</div>
					<!-- Type badge: its text above the type icon, pinned to the bottom-right of
						 the art. -->
					<div
						class="absolute right-1 bottom-1 z-20 flex flex-col items-end gap-0.5 text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
						title="Type"
						aria-label="Type"
					>
						<span class="text-right text-[10px] leading-tight font-semibold tracking-wide uppercase">
							{#each typeLines as line, i (i)}
								<span class="block text-right">{line}</span>
							{/each}
						</span>
						{#if typeIconUrl}
							<img src={typeIconUrl} alt="" aria-hidden="true" class="h-[18px] w-[18px] object-contain" />
						{/if}
					</div>
				{/if}
			</figure>
		</div>

		<!-- Atk / reach / def / SPD row: a 4-column grid under the card art, each cell
		     showing its icon on the left and value on the right (see statRow). Dropped
		     on non-monster cards. -->
		{#if showStats}
			<div class="grid grid-cols-4 gap-1">
				{@render statRow('Atk', '[mask-image:url(/assets/icons/lorc/broadsword.svg)]', card.atk)}
				{@render statRow('Reach', '[mask-image:url(/assets/icons/lorc/arrowhead.svg)]', card.reach)}
				{@render statRow('Def', '[mask-image:url(/assets/icons/lorc/edged-shield.svg)]', card.def)}
				{@render statRow('SPD', '[mask-image:url(/assets/icons/lorc/walking-boot.svg)]', card.speed)}
			</div>
		{/if}

		<!-- Spell effect text: for a card that represents a board spell, its effect
		     (authored on /spells) is printed at the bottom, in the same white/50 boxed,
		     drop-shadowed treatment as the rest of the card copy. -->
		{#if spellForCard?.description}
			<div
				class="rounded bg-white/50 px-1.5 py-1 text-center text-[9px] leading-snug font-semibold text-white [filter:drop-shadow(0_0_1px_#000)_drop-shadow(0_0_1px_#000)]"
			>
				{spellForCard.description}
			</div>
		{/if}

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
