<script lang="ts">
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { effectsService } from '$services/effect.service';
	import { effectAdapter } from '$adapters/effect.adapter';
	import { getCardImplementations, setCardImplementations } from '$services/card-effects.service';
	import { CREATURE_STATS, type CardEffect } from '$types/effect.type';
	import type { CardEffectImplementation } from '$types/card-effect.type';

	let { card, onClose }: { card: CardAsset; onClose: () => void } = $props();

	// The effect templates defined on /admin/effects, mirrored so the picker
	// reflects any edits made there.
	let templates = $state<CardEffect[]>(effectsService.all());
	effectsService.store.subscribe((v) => (templates = v));

	// Draft of this card's implementations, committed to the service on save.
	let draft = $state<CardEffectImplementation[]>(
		structuredClone(getCardImplementations(card.id))
	);

	// The template chosen in the "add" picker before it's committed to the draft.
	let picked = $state('');

	function templateFor(effectId: string | number): CardEffect | undefined {
		return templates.find((t) => String(t.id) === String(effectId));
	}

	function addImplementation() {
		const template = templateFor(picked);
		if (!template) return;
		// Seed the card's values from each templated param's default.
		const values: Record<string, string | number> = {};
		for (const param of effectAdapter.templatedParams(template)) {
			values[param.key] = param.defaultValue;
		}
		draft = [...draft, { id: crypto.randomUUID(), effectId: template.id, values }];
		picked = '';
	}

	function removeImplementation(index: number) {
		draft = draft.filter((_, i) => i !== index);
	}

	let saving = $state(false);
	let saveError = $state('');

	async function save() {
		saving = true;
		saveError = '';
		try {
			await setCardImplementations(card.id, structuredClone($state.snapshot(draft)));
			onClose();
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Could not save card effects.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="modal modal-open" role="dialog" aria-modal="true">
	<div class="modal-box max-w-2xl">
		<div class="mb-4 flex items-start justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold">Card effects</h2>
				<p class="text-base-content/60 text-sm">
					Implement effect templates for <span class="font-medium">{card.name}</span>.
				</p>
			</div>
			<button class="btn btn-sm btn-circle btn-ghost" onclick={onClose} aria-label="Close">✕</button>
		</div>

		<!-- Current implementations -->
		<div class="space-y-3">
			{#if !draft.length}
				<p class="text-base-content/50 text-sm">
					This card implements no effects yet. Add one below.
				</p>
			{:else}
				{#each draft as implementation, i (implementation.id)}
					{@const template = templateFor(implementation.effectId)}
					<div class="bg-base-200 rounded-lg p-3">
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								{#if template}
									<div class="flex items-center gap-2">
										<h3 class="font-semibold">{template.name}</h3>
										<span class="badge badge-outline badge-sm">{template.kind}</span>
									</div>
									<p class="text-base-content/70 mt-1 text-sm">
										{effectAdapter.toDisplayText(template, implementation.values)}
									</p>
								{:else}
									<p class="text-error text-sm">
										Unknown effect template (it may have been deleted).
									</p>
								{/if}
							</div>
							<button
								class="btn btn-ghost btn-xs text-error"
								onclick={() => removeImplementation(i)}
							>
								Remove
							</button>
						</div>

						{#if template}
							{@const params = effectAdapter.templatedParams(template)}
							{#if params.length}
								<div class="mt-3 grid gap-3 sm:grid-cols-2">
									{#each params as param (param.key)}
										<label class="form-control">
											<span class="label-text mb-1 text-xs">{param.label}</span>
											{#if param.type === 'stat'}
												<select
													class="select select-bordered select-sm w-full"
													bind:value={implementation.values[param.key]}
												>
													{#each CREATURE_STATS as stat (stat.value)}
														<option value={stat.value}>{stat.label}</option>
													{/each}
												</select>
											{:else if param.type === 'number'}
												<input
													type="number"
													class="input input-bordered input-sm w-full"
													bind:value={implementation.values[param.key]}
												/>
											{:else}
												<input
													class="input input-bordered input-sm w-full"
													bind:value={implementation.values[param.key]}
												/>
											{/if}
										</label>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<!-- Add a template -->
		<div class="mt-4 flex items-end gap-2">
			<label class="form-control flex-1">
				<span class="label-text mb-1 text-xs">Add effect template</span>
				<select class="select select-bordered select-sm w-full" bind:value={picked}>
					<option value="">Choose a template…</option>
					{#each templates as template (template.id)}
						<option value={String(template.id)}>{template.name}</option>
					{/each}
				</select>
			</label>
			<button class="btn btn-sm btn-outline" disabled={!picked} onclick={addImplementation}>
				Add
			</button>
		</div>

		{#if saveError}
			<div class="alert alert-error mt-4" role="alert">{saveError}</div>
		{/if}

		<div class="modal-action">
			<button class="btn btn-ghost btn-sm" onclick={onClose} disabled={saving}>Cancel</button>
			<button class="btn btn-primary btn-sm" onclick={save} disabled={saving}>
				{#if saving}
					<span class="loading loading-spinner loading-xs"></span>
				{/if}
				Save
			</button>
		</div>
	</div>
	<button class="modal-backdrop" onclick={onClose} aria-label="Close">close</button>
</div>
