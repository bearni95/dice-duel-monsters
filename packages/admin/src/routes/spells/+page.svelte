<script lang="ts">
	import { onMount } from 'svelte';
	import CardSearchModal from '$components/cards/CardSearchModal.svelte';
	import AdminCardPreview from '$components/cards/AdminCardPreview.svelte';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { spells as spellStore, ensureSpells, saveSpells } from '$services/spell.service';
	import type { SpellDefinition } from '$types/spell.type';

	// The six board spells, editable as JSON: each has an editable name and
	// description plus an associated magic/trap card chosen through the card search
	// modal (the same catalog browser as /cards). Edits are held in a local draft
	// and persisted wholesale to the spells store on Save.
	const cardApiAdapter = new CardApiAdapter();

	let draft = $state<SpellDefinition[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let saveError = $state('');
	let savedAt = $state<number | null>(null);

	// Resolved catalog assets for every associated card id, so each spell can show
	// its card's baked art. Keyed by card id.
	let assetsById = $state<Record<number, CardAsset>>({});

	// Which spell's card picker is open (index into `draft`), or null when closed.
	let pickingIndex = $state<number | null>(null);

	// The full spell set is mirrored from the store; the local draft is what the
	// form edits, so unsaved changes never leak into the shared store.
	spellStore.subscribe((list) => {
		// Only (re)seed the draft from the store on first load; later store refreshes
		// come from our own saves, which already match the draft.
		if (loading) {
			draft = list.map((s) => ({ ...s, card: s.card ? { ...s.card } : null }));
		}
	});

	const dirty = $derived(() => {
		const current = $spellStore;
		if (current.length !== draft.length) return true;
		return draft.some((d, i) => {
			const s = current[i];
			return (
				!s ||
				s.name !== d.name ||
				s.description !== d.description ||
				(s.card?.id ?? null) !== (d.card?.id ?? null)
			);
		});
	});

	async function resolveAssets(list: SpellDefinition[]) {
		const ids = list.map((s) => s.card?.id).filter((id): id is number => typeof id === 'number');
		if (!ids.length) return;
		try {
			const entries = await cardApiAdapter.loadDeckEditorCards(ids);
			const next = { ...assetsById };
			for (const { card } of entries) next[card.id] = card;
			assetsById = next;
		} catch {
			// A missing preview is non-fatal; the card ref/name still shows.
		}
	}

	onMount(async () => {
		const list = await ensureSpells();
		draft = list.map((s) => ({ ...s, card: s.card ? { ...s.card } : null }));
		loading = false;
		resolveAssets(list);
	});

	function openPicker(index: number) {
		pickingIndex = index;
	}

	// Assigning (or clearing) a card is persisted immediately so the association
	// survives a page refresh without needing the manual Save — text edits still
	// batch under Save changes, but the card link writes straight through.
	async function selectCard(card: CardAsset) {
		if (pickingIndex === null) return;
		draft[pickingIndex] = { ...draft[pickingIndex], card: { id: card.id, name: card.name } };
		assetsById = { ...assetsById, [card.id]: card };
		pickingIndex = null;
		await save();
	}

	async function removeCard(index: number) {
		draft[index] = { ...draft[index], card: null };
		await save();
	}

	async function save() {
		saving = true;
		saveError = '';
		try {
			await saveSpells($state.snapshot(draft));
			savedAt = Date.now();
			resolveAssets(draft);
		} catch (error) {
			saveError = error instanceof Error ? error.message : 'Could not save spells.';
		} finally {
			saving = false;
		}
	}

	function reset() {
		draft = $spellStore.map((s) => ({ ...s, card: s.card ? { ...s.card } : null }));
		saveError = '';
	}
</script>

<svelte:head>
	<title>Spells | Admin</title>
	<meta name="description" content="Edit the six board spells and their associated cards." />
</svelte:head>

<main class="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
	<header class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
			<h1 class="text-2xl font-bold">Spells</h1>
			<p class="text-base-content/60 text-sm">
				The six board spells. Each rolls 1d6 when found for its X value. Edit the copy and
				associate a magic or trap card with each effect.
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if savedAt && !dirty()}
				<span class="text-success text-xs">Saved</span>
			{/if}
			{#if saveError}
				<span class="text-error text-xs">{saveError}</span>
			{/if}
			<button class="btn btn-ghost btn-sm" onclick={reset} disabled={saving || !dirty()}>
				Reset
			</button>
			<button class="btn btn-primary btn-sm" onclick={save} disabled={saving || !dirty()}>
				{saving ? 'Saving…' : 'Save changes'}
			</button>
		</div>
	</header>

	{#if loading}
		<div class="flex justify-center py-20" aria-live="polite">
			<span class="loading loading-spinner loading-lg text-primary" aria-label="Loading spells"></span>
		</div>
	{:else}
		<section class="space-y-4">
			{#each draft as spell, i (spell.key)}
				{@const asset = spell.card ? assetsById[spell.card.id] : null}
				<article class="card border-base-300 bg-base-100 border shadow-sm">
					<div class="card-body gap-4 sm:flex-row">
						<!-- Associated card preview -->
						<div class="w-[300px] shrink-0 space-y-2">
							{#if spell.card}
								{#if asset}
									<AdminCardPreview card={asset} />
								{:else}
									<div
										class="border-base-300 bg-base-200 text-base-content/60 flex aspect-[59/86] w-full items-center justify-center rounded border p-2 text-center text-xs"
									>
										{spell.card.name}
									</div>
								{/if}
								<div class="flex gap-1">
									<button class="btn btn-xs btn-outline flex-1" onclick={() => openPicker(i)}>
										Change
									</button>
									<button class="btn btn-xs btn-ghost text-error" onclick={() => removeCard(i)}>
										Remove
									</button>
								</div>
							{:else}
								<div
									class="border-base-300 text-base-content/40 flex aspect-[59/86] w-full items-center justify-center rounded border border-dashed p-2 text-center text-xs"
								>
									No card
								</div>
								<button class="btn btn-xs btn-primary w-full" onclick={() => openPicker(i)}>
									Select card
								</button>
							{/if}
						</div>

						<!-- Editable copy -->
						<div class="flex-1 space-y-3">
							<div class="flex items-center gap-2">
								<span class="badge badge-outline badge-sm">{spell.key}</span>
							</div>
							<label class="form-control w-full">
								<span class="label-text text-xs">Name</span>
								<input
									class="input input-bordered input-sm w-full"
									bind:value={draft[i].name}
									placeholder="Spell name"
								/>
							</label>
							<label class="form-control w-full">
								<span class="label-text text-xs">Description</span>
								<textarea
									class="textarea textarea-bordered w-full text-sm"
									rows="2"
									bind:value={draft[i].description}
									placeholder="What the spell does"
								></textarea>
							</label>
						</div>
					</div>
				</article>
			{/each}
		</section>
	{/if}

	<CardSearchModal
		open={pickingIndex !== null}
		title={pickingIndex !== null ? `Select a card for ${draft[pickingIndex]?.name ?? 'spell'}` : 'Select a card'}
		onSelect={selectCard}
		onClose={() => (pickingIndex = null)}
	/>
</main>
