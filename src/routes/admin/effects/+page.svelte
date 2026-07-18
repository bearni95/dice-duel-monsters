<script lang="ts">
	import classNames from 'classnames';
	import EffectForm from '$components/effects/EffectForm.svelte';
	import { effectsService } from '$services/effect.service';
	import { effectAdapter } from '$adapters/effect.adapter';
	import { CARD_CATEGORIES, type CardEffect, type EffectParam } from '$types/effect.type';

	// Saved effects, mirrored from the store so the list re-renders on change.
	let effects = $state<CardEffect[]>(effectsService.all());
	effectsService.store.subscribe((v) => (effects = v));

	// `null` = nothing open, 'new' = the create form, otherwise an effect id.
	let editing = $state<string | null>(null);
	let draft = $state<CardEffect | null>(null);

	function startCreate() {
		draft = effectAdapter.createDefault();
		editing = 'new';
	}

	function startEdit(effect: CardEffect) {
		draft = structuredClone($state.snapshot(effect));
		editing = String(effect.id);
	}

	function cancel() {
		editing = null;
		draft = null;
	}

	function save(effect: CardEffect) {
		if (effectsService.exists(effect.id)) {
			effectsService.update(effect);
		} else {
			effectsService.add(effect);
		}
		cancel();
	}

	function remove(effect: CardEffect) {
		effectsService.remove(effect);
		if (editing === String(effect.id)) cancel();
	}

	// Which templated params a card can customize when implementing an effect.
	function templatedParams(effect: CardEffect) {
		return effect.kind === 'gain-stat' ? effect.params.filter((p) => p.mode === 'templated') : [];
	}

	// Short suffix describing how a param's value is produced.
	function paramModeLabel(param: EffectParam): string {
		if (param.mode === 'templated') return 'templated';
		if (param.mode === 'dice') return `${param.dice ?? 1}d6`;
		return String(param.defaultValue);
	}

	// The non-empty criteria of a requirement effect, as { label, value } chips.
	function requirementCriteria(effect: CardEffect): Array<{ label: string; value: string }> {
		if (effect.kind !== 'requirement') return [];
		const { category, subType, attribute } = effect.requirement;
		const chips: Array<{ label: string; value: string }> = [];
		if (category) {
			chips.push({
				label: 'Type',
				value: CARD_CATEGORIES.find((c) => c.value === category)?.label ?? category
			});
		}
		if (subType) chips.push({ label: 'Sub-type', value: subType });
		if (attribute) chips.push({ label: 'Attribute', value: attribute });
		return chips;
	}
</script>

<svelte:head>
	<title>Card effects | Admin</title>
	<meta name="description" content="Define, review, and edit on-board card effects." />
</svelte:head>

<main class="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<h1 class="text-2xl font-bold">Card effects</h1>
			<p class="text-base-content/60 text-sm">
				Define on-board card effects. Templated parameters are filled in by each card when it
				implements the effect.
			</p>
		</div>
		{#if editing !== 'new'}
			<button class="btn btn-primary btn-sm" onclick={startCreate}>New effect</button>
		{/if}
	</header>

	{#if editing === 'new' && draft}
		<section class="space-y-2">
			<h2 class="text-lg font-semibold">New effect</h2>
			<EffectForm effect={draft} onSave={save} onCancel={cancel} />
		</section>
	{/if}

	<section class="space-y-3">
		{#if !effects.length}
			<p class="text-base-content/50 text-sm">No effects yet. Create one to get started.</p>
		{:else}
			{#each effects as effect (effect.id)}
				{#if editing === String(effect.id) && draft}
					<EffectForm effect={draft} onSave={save} onCancel={cancel} />
				{:else}
					<article class="card border-base-300 bg-base-100 border shadow-sm">
						<div class="card-body gap-3">
							<div class="flex flex-wrap items-start justify-between gap-3">
								<div>
									<div class="flex items-center gap-2">
										<h2 class="text-lg font-semibold">{effect.name}</h2>
										<span class="badge badge-outline badge-sm">{effect.kind}</span>
									</div>
									<p class="text-base-content/70 mt-1 text-sm">
										{effectAdapter.toDisplayText(effect)}
									</p>
								</div>
								<div class="flex gap-1">
									<button class="btn btn-xs btn-outline" onclick={() => startEdit(effect)}>Edit</button>
									<button class="btn btn-xs btn-ghost text-error" onclick={() => remove(effect)}>
										Delete
									</button>
								</div>
							</div>

							{#if effect.kind === 'gain-stat'}
								{#if effect.params.length}
									<div class="flex flex-wrap gap-2">
										{#each effect.params as param (param.key)}
											<span
												class={classNames('badge badge-sm gap-1', {
													'badge-primary': param.mode === 'templated',
													'badge-secondary': param.mode === 'dice',
													'badge-ghost': param.mode === 'fixed'
												})}
												title={param.mode === 'templated'
													? 'Templated — customized per card'
													: param.mode === 'dice'
														? `Rolls ${param.dice ?? 1}d6 and adds the total`
														: `Fixed — always ${param.defaultValue}`}
											>
												{param.label}
												<span class="opacity-70">({paramModeLabel(param)})</span>
											</span>
										{/each}
									</div>
								{/if}

								{#if templatedParams(effect).length}
									<p class="text-base-content/40 text-xs">
										Each card customizes: {templatedParams(effect)
											.map((p) => p.label)
											.join(', ')}
									</p>
								{/if}
							{:else if effect.kind === 'requirement'}
								{#if requirementCriteria(effect).length}
									<div class="flex flex-wrap gap-2">
										{#each requirementCriteria(effect) as criterion (criterion.label)}
											<span class="badge badge-sm badge-accent gap-1">
												<span class="opacity-70">{criterion.label}:</span>
												{criterion.value}
											</span>
										{/each}
									</div>
									<p class="text-base-content/40 text-xs">
										Only matching cards are candidates for the other effects.
									</p>
								{:else}
									<p class="text-base-content/40 text-xs">
										No criteria set — every card is a candidate for the other effects.
									</p>
								{/if}
							{/if}
						</div>
					</article>
				{/if}
			{/each}
		{/if}
	</section>
</main>
