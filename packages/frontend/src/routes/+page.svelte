<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import { playerService } from '$services/player.service';
	import { authService } from '$services/auth.service';
	import { characters } from '$data/characters';
	import { diceAdapter } from '$adapters/dice.adapter';
	import type { DiceTemplateConfig } from '$types/dice.type';
	import DiceCollectionCanvas3D, {
		type DieSpec
	} from '$components/dice/DiceCollectionCanvas3D.svelte';

	// Discord auth via Supabase, entirely browser-side. Ownership now requires a
	// signed-in account (`authService.configured` must be true and a user present).
	const auth = authService.store;

	// The player's profile and dice, backed by Supabase via `playerService`. It
	// loads on sign-in and clears on sign-out, so name/avatar/dice follow the
	// Discord account across devices rather than living in one browser.
	const player = playerService.store;

	let profile = $derived($player.profile);

	// Draft state for the picker. Seeded from the loaded profile (see the effect
	// below); editing mutates the draft and only `save` commits it to Supabase.
	let name = $state('');
	let avatar = $state<string | null>(null);
	let editing = $state(false);

	// Which profile id the draft has been seeded from, so the effect seeds once per
	// signed-in user instead of clobbering edits on every store update.
	let seededFor = $state<string | null>(null);

	$effect(() => {
		const p = $player.profile;
		if (p && seededFor !== p.id) {
			name = p.name;
			avatar = p.avatar;
			editing = !p.name;
			seededFor = p.id;
		}
	});

	let selectedCharacter = $derived(characters.find((c) => c.slug === avatar) ?? null);
	let canSave = $derived(name.trim().length > 0 && avatar !== null);

	// The dice template config, loaded once, so the player's owned die ids can be
	// resolved into concrete dice and rendered in the same 3D canvas the admin uses.
	let diceConfig = $state<DiceTemplateConfig | null>(null);

	// The raw list of owned die ids (duplicates kept), and the total copy count.
	let ownedIds = $derived($player.dice);

	// One entry per distinct (type, rarity) the player owns, each with its copy
	// count. This drives both the tumbling-dice gallery and its underneath labels.
	let ownedDice = $derived(diceConfig ? diceAdapter.ownedUnique(diceConfig, ownedIds) : []);

	async function save() {
		if (!canSave) return;
		await playerService.saveProfile(name.trim(), avatar);
		editing = false;
	}

	function edit() {
		name = profile?.name ?? '';
		avatar = profile?.avatar ?? null;
		editing = true;
	}

	// The distinct owned dice as canvas specs — one shared WebGL canvas tumbles them
	// all, in the same order as `ownedDice` so the count labels line up underneath.
	let diceSpecs = $derived<DieSpec[]>(
		ownedDice.map(({ die }) => ({
			id: die.id,
			faceIcons: diceAdapter.faceIcons(die),
			faceLabels: diceAdapter.faceLabels(die),
			color: diceAdapter.colorNumber(die)
		}))
	);

	// The owned dice tallied into a rarity-by-type grid (rows = rarity, columns =
	// die type) for the inventory table below the canvas.
	let diceGrid = $derived(diceConfig ? diceAdapter.ownedGrid(diceConfig, ownedIds) : null);

	// Grant three random dice (from every die the game can produce) and persist them
	// to the player's Supabase-backed collection.
	async function giveRandomDice() {
		if (!diceConfig) return;
		const granted = diceAdapter.randomDiceIds(diceConfig, 3);
		await playerService.grantDice(granted);
	}

	onMount(async () => {
		diceConfig = await diceAdapter.loadTemplates();
	});
</script>

<svelte:head>
	<title>Dice Guardians</title>
</svelte:head>

<main class="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6 lg:p-8">
	{#if !authService.configured}
		<section class="space-y-2 py-8 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Dice Guardians</h1>
			<p class="text-base-content/60 text-sm">
				Sign-in is required to play, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading}
		<section class="flex items-center justify-center py-16" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Dice Guardians</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to start playing.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else}
		<section
			class="flex items-center justify-between gap-3 rounded-lg bg-base-200 px-3 py-2"
			aria-label="Signed in"
		>
			<div class="flex items-center gap-2 min-w-0">
				{#if $auth.user.avatar}
					<img src={$auth.user.avatar} alt="" class="h-8 w-8 rounded-full" />
				{/if}
				<span class="truncate text-sm">
					Signed in as <span class="font-medium">{$auth.user.name}</span>
				</span>
			</div>
			<button class="btn btn-ghost btn-xs" onclick={() => authService.signOut()}>Sign out</button>
		</section>
		{#if $player.loading}
			<section class="flex items-center justify-center py-16" aria-label="Loading profile">
				<span class="loading loading-spinner loading-lg text-primary"></span>
			</section>
		{:else if editing}
		<section class="space-y-5" aria-label="Player profile">
			<h1 class="text-2xl font-bold">Who's playing?</h1>

			<label class="form-control w-full">
				<span class="label-text mb-1">Your name</span>
				<input
					class="input input-bordered w-full"
					type="text"
					placeholder="Enter your name"
					maxlength="24"
					bind:value={name}
				/>
			</label>

			<div class="space-y-2">
				<span class="label-text">Pick an avatar</span>
				<div class="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
					{#each characters as character (character.slug)}
						<button
							type="button"
							class={classNames(
								'rounded-lg border-2 p-1 transition-colors',
								avatar === character.slug ? 'border-primary' : 'border-transparent hover:border-base-300'
							)}
							aria-pressed={avatar === character.slug}
							aria-label={character.name}
							title={character.name}
							onclick={() => (avatar = character.slug)}
						>
							<img
								src={character.src}
								alt=""
								class="h-auto w-full [image-rendering:pixelated]"
							/>
						</button>
					{/each}
				</div>
			</div>

			<button class="btn btn-primary" disabled={!canSave || $player.saving} onclick={save}>
				Save
			</button>
		</section>
	{:else}
		<section class="flex items-center gap-4" aria-label="Player profile">
			{#if selectedCharacter}
				<img
					src={selectedCharacter.src}
					alt={selectedCharacter.name}
					class="border-primary h-20 w-20 rounded-lg border-2 [image-rendering:pixelated]"
				/>
			{/if}
			<div class="min-w-0 flex-1">
				<p class="text-base-content/50 text-xs uppercase tracking-wide">Player</p>
				<p class="truncate text-2xl font-bold">{profile?.name}</p>
			</div>
			<button class="btn btn-ghost btn-sm" onclick={edit}>Edit</button>
		</section>

		<section class="space-y-4" aria-label="Your dice">
			<div class="flex items-center justify-between gap-4">
				<div>
					<h2 class="text-xl font-bold">Your dice</h2>
					<p class="text-base-content/60 text-sm">
						{ownedIds.length}
						{ownedIds.length === 1 ? 'die' : 'dice'} owned
					</p>
				</div>
				<button
					class="btn btn-primary btn-sm"
					disabled={!diceConfig || $player.saving}
					onclick={giveRandomDice}
				>
					Give 3 random dice
				</button>
			</div>

			{#if ownedDice.length > 0}
				<!-- One shared WebGL canvas tumbles every distinct die in a strip; a
				     matching row of 88px-wide cells shows each die's copy count directly
				     underneath it (tile width matches the canvas `tileSize`). -->
				<div class="card overflow-x-auto bg-base-200 p-4">
					<div class="inline-block">
						<DiceCollectionCanvas3D dice={diceSpecs} tileSize={88} />
						<div class="flex">
							{#each ownedDice as { die, count } (die.id)}
								<span class="w-[88px] shrink-0 text-center text-sm font-medium">×{count}</span>
							{/each}
						</div>
					</div>
				</div>

				{#if diceGrid}
					<!-- Inventory breakdown: rows are rarity levels, columns are die types,
					     each cell the number of that die the player owns. -->
					<div class="overflow-x-auto">
						<table class="table table-sm">
							<thead>
								<tr>
									<th>Rarity</th>
									{#each diceGrid.templates as template (template.id)}
										<th class="text-center">{template.name}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each diceGrid.rows as row (row.rarity)}
									<tr>
										<th>Rarity {row.rarity}</th>
										{#each row.cells as count, i (diceGrid.templates[i].id)}
											<td class={classNames('text-center', { 'opacity-30': count === 0 })}>
												{count}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{:else}
				<div class="text-base-content/60 rounded-lg border border-dashed border-base-300 p-6 text-center text-sm">
					You don't own any dice yet. Grab some to get started.
				</div>
			{/if}
		</section>
		{/if}
	{/if}
</main>
