<script lang="ts">
	import { onMount } from 'svelte';
	import DiceCanvas3D from '$components/dice/DiceCanvas3D.svelte';
	import IconDiceCanvas3D from '$components/dice/IconDiceCanvas3D.svelte';
	import DiceFaceViewer from '$components/dice/DiceFaceViewer.svelte';
	import Button from '$components/core/Button.svelte';
	import { ThemeColors, ThemeSizes } from '$types/core.type';
	import { diceAdapter } from '$adapters/dice.adapter';
	import type { DiceTemplate, DiceTemplateConfig, SpawnedDie } from '$types/dice.type';

	// Each throw is a fixed 50ms arrange off the face + random spin + 50ms arrange
	// onto the face. The slider controls just the middle random-spin duration.
	const ARRANGE_MS = 100;
	let dice = $state<DiceCanvas3D>();
	let iconDice = $state<IconDiceCanvas3D>();
	let rolling = $state(false);
	let lastResult = $state<number | null>(null);
	let spinMs = $state(300);

	async function roll() {
		if (rolling || !dice || !iconDice) return;
		rolling = true;
		lastResult = null;
		const [[value]] = await Promise.all([dice.roll(1), iconDice.roll(1)]);
		rolling = false;
		lastResult = value;
	}

	// --- Template-spawned dice (static/dice/templates.json) ------------------
	// The page reads the template config and spawns every possible die (each
	// template × each rarity). The definitions themselves are hand-authored JSON;
	// the concrete dice below are generated from them at load time.
	let config = $state<DiceTemplateConfig | null>(null);
	let spawned = $state<SpawnedDie[]>([]);
	let loading = $state(true);
	let loadError = $state('');
	let selectedId = $state('');

	let selected = $derived(spawned.find((d) => d.id === selectedId) ?? spawned[0] ?? null);

	// Spawned dice grouped by their template, preserving template order.
	let byTemplate = $derived(
		(config?.templates ?? []).map((template) => ({
			template,
			dice: spawned.filter((d) => d.templateId === template.id)
		}))
	);

	// Remount key so the 3D face viewer rebuilds its canvases (which load face
	// textures once, on mount) whenever the shown die changes.
	function signature(die: SpawnedDie): string {
		return `${die.id}:${die.color ?? ''}:${JSON.stringify(die.faces)}`;
	}

	function roleLabel(template: DiceTemplate): string {
		return config?.roles[template.role]?.label ?? template.role;
	}

	onMount(async () => {
		loading = true;
		loadError = '';
		try {
			config = await diceAdapter.loadTemplates();
			spawned = diceAdapter.spawnAll(config);
			selectedId = spawned[0]?.id ?? '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Could not load dice templates.';
		} finally {
			loading = false;
		}
	});
</script>

<section class="flex min-h-screen flex-col items-center gap-10 bg-base-200 p-8">
	<h1 class="text-3xl font-bold text-base-content">3D Dice</h1>

	<div class="flex h-72 items-center justify-center gap-8">
		<DiceCanvas3D bind:this={dice} size={260} arrangeMs={ARRANGE_MS} {spinMs} initialValues={[1]} />

		<IconDiceCanvas3D
			bind:this={iconDice}
			size={260}
			arrangeMs={ARRANGE_MS}
			{spinMs}
			initialValues={[1]}
		/>
	</div>

	<div class="flex w-72 flex-col gap-2">
		<div class="flex items-center justify-between text-sm text-base-content">
			<span>Spin duration</span>
			<span class="font-mono font-semibold text-primary">{spinMs}ms</span>
		</div>
		<input
			type="range"
			class="range range-primary range-sm"
			min="100"
			max="2000"
			step="50"
			bind:value={spinMs}
			disabled={rolling}
		/>
		<div class="flex justify-between text-xs opacity-50">
			<span>100ms</span>
			<span>2000ms</span>
		</div>
	</div>

	<Button
		label={rolling ? 'Rolling…' : 'Roll'}
		color={ThemeColors.Primary}
		size={ThemeSizes.Large}
		disabled={rolling}
		on:click={roll}
	/>

	<div class="flex h-10 items-center text-lg text-base-content">
		{#if rolling}
			<span class="opacity-60">Rolling the die…</span>
		{:else if lastResult !== null}
			<span>You rolled a <span class="font-bold text-primary">{lastResult}</span></span>
		{:else}
			<span class="opacity-60">Press roll to throw the die</span>
		{/if}
	</div>

	<!-- Template-spawned dice -->
	<div class="flex w-full max-w-5xl flex-col gap-6">
		<div>
			<h2 class="text-2xl font-bold text-base-content">Dice templates</h2>
			<p class="text-sm text-base-content opacity-70">
				Every die the game can spawn — each template (Move / Summon / Attack) across all six
				rarities, coloured by rarity in gay-pride flag order.
			</p>
		</div>

		{#if loadError}
			<div class="alert alert-error">{loadError}</div>
		{/if}

		{#if loading}
			<div class="flex justify-center p-8">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{:else}
			{#each byTemplate as { template, dice: rarityDice } (template.id)}
				<div class="flex flex-col gap-3">
					<h3 class="flex items-center gap-2 text-xl font-semibold text-base-content">
						<img src={config?.roles[template.role]?.icon} alt="" class="h-6 w-6 object-contain" />
						{template.name}
						<span class="text-sm font-normal opacity-60">({roleLabel(template)})</span>
					</h3>

					<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
						{#each rarityDice as die (die.id)}
							<button
								type="button"
								class="card border-2 bg-base-100 p-2 text-left shadow-sm transition hover:shadow-md"
								class:border-primary={selected?.id === die.id}
								class:border-transparent={selected?.id !== die.id}
								onclick={() => (selectedId = die.id)}
							>
								<div class="flex items-center justify-between gap-1">
									<span class="text-xs font-semibold text-base-content">R{die.rarity}</span>
									<span
										class="h-3 w-3 shrink-0 rounded-full border border-base-300"
										style:background-color={die.color}
										title={die.color}
									></span>
								</div>

								<!-- Lightweight DOM preview of the six faces (no WebGL). -->
								<div class="mt-2 grid grid-cols-3 gap-1">
									{#each die.faces as face, i (i)}
										<div
											class="relative flex aspect-square items-center justify-center rounded bg-base-200"
										>
											{#if face.icon}
												<img src={face.icon} alt="" class="h-4 w-4 object-contain" />
											{/if}
											<span class="absolute bottom-0 right-0.5 text-[9px] font-bold leading-none text-base-content">
												{face.value}
											</span>
										</div>
									{/each}
								</div>
							</button>
						{/each}
					</div>
				</div>
			{/each}

			{#if selected}
				<div class="card bg-base-100 shadow-xl">
					<div class="card-body items-center">
						<h3 class="card-title text-base-content">{selected.name} — 3D faces</h3>
						{#key signature(selected)}
							<DiceFaceViewer
								variant="icon"
								faceIcons={diceAdapter.faceIcons(selected)}
								faceLabels={diceAdapter.faceLabels(selected)}
								baseColor={diceAdapter.colorNumber(selected)}
								showCaptions={false}
							/>
						{/key}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</section>
