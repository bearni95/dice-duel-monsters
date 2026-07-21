<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import {
		CARD_CATEGORIES,
		CREATURE_STATS,
		EFFECT_KINDS,
		EFFECT_PARAM_MODES,
		MONSTER_RACES,
		type CardEffect,
		type EffectKind,
		type EffectParam,
		type EffectParamType
	} from '$types/effect.type';
	import { effectAdapter } from '$adapters/effect.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';

	let {
		effect,
		onSave,
		onCancel
	}: {
		// The effect to edit. A blank one (from the adapter) creates a new effect.
		effect: CardEffect;
		onSave: (effect: CardEffect) => void;
		onCancel?: () => void;
	} = $props();

	// Work on a deep copy so edits are only committed on save.
	let draft = $state<CardEffect>(structuredClone($state.snapshot(effect)));

	const paramTypes: Array<{ value: EffectParamType; label: string }> = [
		{ value: 'stat', label: 'Stat' },
		{ value: 'number', label: 'Number' },
		{ value: 'text', label: 'Text' }
	];

	// Card facets for the requirement editor, mirroring /admin/cards: sub-types
	// depend on the chosen category (monster variety, or spell/trap race), and
	// attributes are the monster attributes (DARK, LIGHT, …). Loaded from the
	// same /database/cards endpoint the cards page uses.
	let monsterTypes = $state<string[]>([]);
	let spellTypes = $state<string[]>([]);
	let trapTypes = $state<string[]>([]);
	let attributes = $state<string[]>([]);
	let facetsError = $state('');

	const subTypeOptions = $derived(
		draft.kind === 'requirement' && draft.requirement.category === 'monster'
			? monsterTypes
			: draft.kind === 'requirement' && draft.requirement.category === 'spell'
				? spellTypes
				: draft.kind === 'requirement' && draft.requirement.category === 'trap'
					? trapTypes
					: []
	);

	async function loadFacets() {
		try {
			const cardApiAdapter = new CardApiAdapter();
			cardApiAdapter.limit = 1;
			const res = await cardApiAdapter.loadCatalog(1);
			monsterTypes = res.monsterTypes;
			spellTypes = res.spellTypes;
			trapTypes = res.trapTypes;
			attributes = res.availableAttributes;
		} catch (error) {
			facetsError = error instanceof Error ? error.message : 'Could not load card criteria.';
		}
	}

	onMount(loadFacets);

	// Preview the effect (a description for gain-stat, the criteria for a
	// requirement) using the adapter so it matches how it renders elsewhere.
	let preview = $derived(effectAdapter.toDisplayText(draft));

	// Switching kinds swaps the draft to that kind's default shape, keeping the
	// id and name so an in-progress edit isn't lost.
	function onKindChange(kind: EffectKind) {
		if (kind === draft.kind) return;
		const next = effectAdapter.createDefault(kind);
		next.id = draft.id;
		next.name = draft.name;
		draft = next;
	}

	// Changing the category invalidates any sub-type or race chosen under the old
	// one (race only applies to monsters).
	function onCategoryChange() {
		if (draft.kind === 'requirement') {
			draft.requirement.subType = '';
			if (draft.requirement.category !== 'monster') draft.requirement.race = '';
		}
	}

	function addParam() {
		if (draft.kind !== 'gain-stat') return;
		const param: EffectParam = {
			key: `param${draft.params.length + 1}`,
			label: 'New parameter',
			type: 'number',
			mode: 'fixed',
			defaultValue: 0
		};
		draft.params = [...draft.params, param];
	}

	function removeParam(index: number) {
		if (draft.kind !== 'gain-stat') return;
		draft.params = draft.params.filter((_, i) => i !== index);
	}

	// Keep a param's default value coherent with its type when the type changes.
	// Dice mode only applies to number params, so fall back to fixed otherwise.
	function onTypeChange(param: EffectParam) {
		if (param.type === 'stat') param.defaultValue = 'atk';
		else if (param.type === 'number') param.defaultValue = 0;
		else param.defaultValue = '';
		if (param.type !== 'number' && param.mode === 'dice') param.mode = 'fixed';
	}

	// Ensure a dice count exists once a param switches to the d6-roll mode.
	function onModeChange(param: EffectParam) {
		if (param.mode === 'dice' && !param.dice) param.dice = 1;
	}

	function save() {
		onSave(structuredClone($state.snapshot(draft)));
	}
</script>

<div class="card bg-base-100 border-base-300 border shadow-sm">
	<div class="card-body gap-4">
		<div class="grid gap-4 sm:grid-cols-2">
			<label class="form-control">
				<span class="label-text mb-1">Name</span>
				<input class="input input-bordered w-full" bind:value={draft.name} placeholder="Gain stat" />
			</label>

			<label class="form-control">
				<span class="label-text mb-1">Kind</span>
				<select
					class="select select-bordered w-full"
					value={draft.kind}
					onchange={(e) => onKindChange((e.currentTarget as HTMLSelectElement).value as EffectKind)}
				>
					{#each EFFECT_KINDS as kind (kind.value)}
						<option value={kind.value}>{kind.label}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if draft.kind === 'gain-stat'}
			<label class="form-control">
				<span class="label-text mb-1">Description template</span>
				<input
					class="input input-bordered w-full"
					bind:value={draft.description}
					placeholder="Raise {'{stat}'} by {'{amount}'}"
				/>
				<span class="label-text-alt text-base-content/50 mt-1">
					Use <code>{'{key}'}</code> tokens to insert a parameter's value.
				</span>
			</label>

			<!-- Parameters -->
			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold">Parameters</h3>
					<button class="btn btn-xs btn-outline" onclick={addParam}>Add parameter</button>
				</div>

				{#if !draft.params.length}
					<p class="text-base-content/50 text-sm">No parameters yet.</p>
				{:else}
					<div class="space-y-3">
						{#each draft.params as param, i (i)}
							<div class="bg-base-200 relative rounded-lg p-3 pt-8">
								<button
									class="btn btn-ghost btn-xs text-error absolute top-2 right-2"
									onclick={() => removeParam(i)}
									aria-label="Remove parameter"
								>
									✕
								</button>

								<div class="grid items-end gap-3 sm:grid-cols-12">
									<label class="form-control sm:col-span-3">
										<span class="label-text mb-1 text-xs">Key</span>
										<input class="input input-bordered input-sm w-full" bind:value={param.key} />
									</label>

									<label class="form-control sm:col-span-3">
										<span class="label-text mb-1 text-xs">Label</span>
										<input class="input input-bordered input-sm w-full" bind:value={param.label} />
									</label>

									<label class="form-control sm:col-span-2">
										<span class="label-text mb-1 text-xs">Type</span>
										<select
											class="select select-bordered select-sm w-full"
											bind:value={param.type}
											onchange={() => onTypeChange(param)}
										>
											{#each paramTypes as t (t.value)}
												<option value={t.value}>{t.label}</option>
											{/each}
										</select>
									</label>

									<label class="form-control sm:col-span-2">
										<span class="label-text mb-1 text-xs">Value</span>
										<select
											class="select select-bordered select-sm w-full"
											bind:value={param.mode}
											onchange={() => onModeChange(param)}
										>
											{#each EFFECT_PARAM_MODES as m (m.value)}
												{#if m.value !== 'dice' || param.type === 'number'}
													<option value={m.value}>{m.label}</option>
												{/if}
											{/each}
										</select>
									</label>

									<label class="form-control sm:col-span-2">
										{#if param.mode === 'dice'}
											<span class="label-text mb-1 text-xs">Dice (d6)</span>
											<input
												type="number"
												min="1"
												class="input input-bordered input-sm w-full"
												bind:value={param.dice}
											/>
										{:else}
											<span class="label-text mb-1 text-xs">
												{param.mode === 'templated' ? 'Default' : 'Amount'}
											</span>
											{#if param.type === 'stat'}
												<select
													class="select select-bordered select-sm w-full"
													bind:value={param.defaultValue}
												>
													{#each CREATURE_STATS as stat (stat.value)}
														<option value={stat.value}>{stat.label}</option>
													{/each}
												</select>
											{:else if param.type === 'number'}
												<input
													type="number"
													class="input input-bordered input-sm w-full"
													bind:value={param.defaultValue}
												/>
											{:else}
												<input
													class="input input-bordered input-sm w-full"
													bind:value={param.defaultValue}
												/>
											{/if}
										{/if}
									</label>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{:else if draft.kind === 'requirement'}
			<div class="space-y-2">
				<p class="text-base-content/60 text-sm">
					A card must match every set criterion below to be a candidate for the rest of the effects.
					Leave a field as <em>Any</em> to not constrain on it.
				</p>
				{#if facetsError}
					<div class="alert alert-warning py-2 text-sm" role="alert">{facetsError}</div>
				{/if}

				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					<label class="form-control">
						<span class="label-text mb-1 text-xs">Category</span>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={draft.requirement.category}
							onchange={onCategoryChange}
						>
							<option value="">Any category</option>
							{#each CARD_CATEGORIES as c (c.value)}
								<option value={c.value}>{c.label}</option>
							{/each}
						</select>
					</label>

					<label class="form-control">
						<span class="label-text mb-1 text-xs">Sub-type</span>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={draft.requirement.subType}
							disabled={!draft.requirement.category}
						>
							<option value="">Any sub-type</option>
							{#each subTypeOptions as s (s)}
								<option value={s}>{s}</option>
							{/each}
						</select>
					</label>

					<label class="form-control">
						<span class="label-text mb-1 text-xs">Type (race)</span>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={draft.requirement.race}
							disabled={draft.requirement.category !== 'monster'}
						>
							<option value="">Any type</option>
							{#each MONSTER_RACES as r (r)}
								<option value={r}>{r}</option>
							{/each}
						</select>
					</label>

					<label class="form-control">
						<span class="label-text mb-1 text-xs">Attribute</span>
						<select
							class="select select-bordered select-sm w-full"
							bind:value={draft.requirement.attribute}
						>
							<option value="">Any attribute</option>
							{#each attributes as a (a)}
								<option value={a}>{a}</option>
							{/each}
						</select>
					</label>
				</div>
			</div>
		{:else}
			<p class="text-base-content/60 text-sm">
				This effect has no configuration — it just exists and is referenced by name.
			</p>
		{/if}

		<div class="bg-base-200/60 rounded-lg p-3">
			<span class="text-base-content/50 text-xs">Preview</span>
			<p class="text-sm font-medium">{preview}</p>
		</div>

		<div class="flex justify-end gap-2">
			{#if onCancel}
				<button class="btn btn-ghost btn-sm" onclick={onCancel}>Cancel</button>
			{/if}
			<button
				class={classNames('btn btn-primary btn-sm', { 'btn-disabled': !draft.name.trim() })}
				onclick={save}
			>
				Save effect
			</button>
		</div>
	</div>
</div>
