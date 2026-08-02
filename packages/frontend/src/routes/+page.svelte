<script lang="ts">
	import classNames from 'classnames';
	import { playerService } from '$services/player.service';
	import { authService } from '$services/auth.service';
	import { playerDeckService } from '$services/player-deck.service';
	import { characters } from '$data/characters';
	import DeckList from '$components/decks/DeckList.svelte';
	import type { PlayerDeck } from '$types/player-deck.type';

	// Discord auth via Supabase, entirely browser-side. Ownership now requires a
	// signed-in account (`authService.configured` must be true and a user present).
	const auth = authService.store;

	// The player's profile and cards, backed by Supabase via `playerService`. It
	// loads on sign-in and clears on sign-out, so name/avatar/cards follow the
	// Discord account across devices rather than living in one browser.
	const player = playerService.store;

	// The player's saved decks, the same store the decks page builds against. Here
	// they are only listed and switched between — building happens on /decks.
	const decks = playerDeckService.store;

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

	// Enable or disable a deck for play, exactly as the decks page does: the board
	// deals from the enabled deck (see playerDeckAdapter.activeDeck), so this is
	// what picks which deck a match is played with.
	function enable(event: CustomEvent<{ deck: PlayerDeck; enabled: boolean }>) {
		void playerDeckService.setEnabled(event.detail.deck.id, event.detail.enabled);
	}
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

		<section class="space-y-4" aria-label="Your decks">
			<div class="flex items-center justify-between gap-4">
				<div>
					<h2 class="text-xl font-bold">Your decks</h2>
					<p class="text-base-content/60 text-sm">
						The active deck is the one you take to the board.
					</p>
				</div>
				<a class="btn btn-primary btn-sm" href="/decks">Build decks</a>
			</div>

			{#if $decks.loading}
				<div class="flex items-center justify-center py-8">
					<span class="loading loading-spinner loading-md text-primary"></span>
				</div>
			{:else}
				<DeckList
					decks={$decks.decks}
					saving={$decks.saving}
					error={$decks.error ?? ''}
					on:enable={enable}
				/>
			{/if}
		</section>
		{/if}
	{/if}
</main>
