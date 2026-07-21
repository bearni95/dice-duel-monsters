<script lang="ts">
	import Button from '$components/core/Button.svelte';
	import { ThemeColors } from '$types/core.type';
	import { diceAdapter } from '$adapters/dice.adapter';
	import type { DiceDefinition } from '$types/dice.type';

	let {
		die,
		onClose,
		onSaved
	}: {
		die: DiceDefinition;
		onClose: () => void;
		onSaved: (die: DiceDefinition) => void;
	} = $props();

	// Editable draft; committed to the store only on save so Cancel discards edits.
	let draft = $state<DiceDefinition>(diceAdapter.clone(die));
	let saving = $state(false);
	let saveError = $state('');

	const isNew = !die.id;

	// The icons already used by the seed die, offered as one-click fills per face
	// (the full library has thousands, so the icon field is otherwise free text).
	const QUICK_ICONS = [
		'/assets/icons/skoll/pentacle.svg',
		'/assets/icons/delapouite/plain-arrow.svg',
		'/assets/icons/lorc/battle-axe.svg'
	];

	async function save() {
		if (!draft.name.trim()) {
			saveError = 'A die name is required.';
			return;
		}
		saving = true;
		saveError = '';
		try {
			const saved = await diceAdapter.save($state.snapshot(draft) as DiceDefinition);
			onSaved(saved);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Could not save die.';
		} finally {
			saving = false;
		}
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
>
	<div class="card max-h-[90vh] w-full max-w-lg overflow-y-auto bg-base-100 shadow-xl">
		<div class="card-body gap-4">
			<h3 class="card-title text-base-content">{isNew ? 'New die' : 'Edit die'}</h3>

			<div class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Name</span>
				<input
					class="input input-bordered w-full"
					placeholder="e.g. Combat Die"
					bind:value={draft.name}
				/>
			</div>

			<div class="flex flex-col gap-1">
				<span class="text-sm font-medium text-base-content">Body colour</span>
				<div class="flex items-center gap-2">
					<input type="color" class="h-10 w-14 rounded border border-base-300" bind:value={draft.color} />
					<input class="input input-bordered flex-1 font-mono" placeholder="#d7382f" bind:value={draft.color} />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<span class="text-sm font-medium text-base-content">Faces</span>
				{#each draft.faces as face, i (i)}
					<div class="flex items-center gap-2 rounded-lg bg-base-200 p-2">
						<span class="w-12 shrink-0 text-xs font-semibold opacity-60">Face {i + 1}</span>
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-base-100">
							{#if face.icon}
								<img src={face.icon} alt="" class="h-8 w-8 object-contain" />
							{:else}
								<span class="text-xs opacity-40">?</span>
							{/if}
						</div>
						<div class="flex flex-1 flex-col gap-1">
							<div class="flex items-center gap-1">
								<input
									class="input input-bordered input-sm flex-1 font-mono text-xs"
									placeholder="/assets/icons/…/name.svg"
									bind:value={face.icon}
								/>
								{#each QUICK_ICONS as quick (quick)}
									<button
										type="button"
										class="flex h-7 w-7 items-center justify-center rounded bg-base-100 hover:bg-base-300"
										title={quick}
										onclick={() => (face.icon = quick)}
									>
										<img src={quick} alt="" class="h-5 w-5 object-contain" />
									</button>
								{/each}
							</div>
							<input
								class="input input-bordered input-sm w-24"
								placeholder="value (x2)"
								bind:value={face.value}
							/>
						</div>
					</div>
				{/each}
			</div>

			{#if saveError}
				<p class="text-sm text-error">{saveError}</p>
			{/if}

			<div class="flex justify-end gap-2">
				<Button label="Cancel" color={ThemeColors.Neutral} outline on:click={onClose} />
				<Button
					label={saving ? 'Saving…' : 'Save die'}
					color={ThemeColors.Primary}
					disabled={saving}
					on:click={save}
				/>
			</div>
		</div>
	</div>
</div>
