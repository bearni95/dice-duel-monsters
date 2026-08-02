<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { playerService } from '$services/player.service';
	import { authService } from '$services/auth.service';
	import { playerDeckService } from '$services/player-deck.service';
	import {
		decks as staticDecks,
		characterDecks,
		refreshDecks,
		refreshAssignments
	} from '$services/deck.service';
	import { characters } from '$data/characters';
	import { characterDeckAdapter, type CharacterWithDeck } from '$adapters/character-deck.adapter';
	import { playerDeckAdapter } from '$adapters/player-deck.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import DeckList from '$components/decks/DeckList.svelte';
	import { AssignedCharacterList } from '$components/characters';
	import { BoosterPackPanel } from '$components/booster';
	import type { CardAsset } from '$components/cards/GameCard.svelte';
	import { DECK_SIZE, type PlayerDeck } from '$types/player-deck.type';

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

	// The authored decks and the character→deck assignments made in the admin
	// package, both served here as static JSON. Together they give the opponents
	// that are ready to play: a character is only one once someone has given it a
	// deck. Neither depends on being signed in, so they load on mount.
	let opponentsLoading = $state(true);
	let opponents = $derived(
		characterDeckAdapter.assigned(characters, $staticDecks, $characterDecks)
	);

	// The deck the player would take into a match: the one they enabled on /decks
	// (a lone deck counts as enabled — see playerDeckAdapter.activeDeck), which is
	// the same deck the board engine deals them from. A match can only be started
	// once that deck is actually finished, so a half-built one blocks the
	// challenge buttons rather than starting a game the player can't play.
	let activeDeck = $derived(playerDeckAdapter.activeDeck($decks.decks));
	let canChallenge = $derived(
		activeDeck !== null && playerDeckAdapter.totalCards(activeDeck.cards) === DECK_SIZE
	);
	let challengeBlockedReason = $derived(
		activeDeck === null
			? `Build a ${DECK_SIZE}-card deck and make it active to challenge.`
			: `Your active deck needs ${DECK_SIZE} cards to challenge.`
	);

	// Start a match against a character: the board takes the rival's deck as a
	// query param, and deals the player from their own active deck on its own (see
	// the board engine's playerAccountCardIds), which is why only the rival's is
	// passed here.
	function challenge(entry: CharacterWithDeck) {
		if (!canChallenge) return;
		goto(`/board?cpu=${encodeURIComponent(entry.deck.id)}`);
	}

	// The pool the pack opener in the middle columns draws from — the same one the
	// /booster page packs: every card the game can actually summon. A failure here
	// leaves the pool empty, which the panel renders as nothing to open rather than
	// taking the rest of the page down with it.
	const cardApiAdapter = new CardApiAdapter();
	let boosterPool = $state<CardAsset[]>([]);

	onMount(async () => {
		await Promise.all([refreshDecks(), refreshAssignments()]);
		opponentsLoading = false;

		try {
			boosterPool = await cardApiAdapter.loadBoosterPool();
		} catch {
			boosterPool = [];
		}
	});
</script>

<svelte:head>
	<title>Dice Guardians</title>
</svelte:head>

<!-- The page fills the viewport and grows past it rather than being capped to it,
     so a long column scrolls the page instead of being clipped. -->
<main class="flex min-h-dvh w-full flex-col p-4 sm:p-6 lg:p-8">
	{#if !authService.configured}
		<section class="mx-auto max-w-2xl space-y-2 py-8 text-center" aria-label="Sign in required">
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
		<section class="mx-auto max-w-2xl space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Dice Guardians</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to start playing.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else}
		<!-- The signed-in page as four columns: who is playing and the decks they play
		     with in the first, the characters that can be played against in the third,
		     and the second and fourth held for what comes next. Below `xl` they fall
		     back to two columns and then to one, since neither panel survives being a
		     quarter of a narrow window. `flex-1` stretches the grid over the whole
		     viewport height; nothing here paints a background, so the layout's card
		     backdrop shows through it. -->
		<div class="grid flex-1 grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
			<div class="min-w-0 space-y-6">
				<section
					class="border-base-300 bg-base-100/50 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 backdrop-blur-md"
					aria-label="Signed in"
				>
					<div class="flex min-w-0 items-center gap-2">
						{#if $auth.user.avatar}
							<img src={$auth.user.avatar} alt="" class="h-8 w-8 rounded-full" />
						{/if}
						<span class="truncate text-sm">
							Signed in as <span class="font-medium">{$auth.user.name}</span>
						</span>
					</div>
					<button class="btn btn-ghost btn-xs" onclick={() => authService.signOut()}>
						Sign out
					</button>
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
							<!-- Four across whatever the breakpoint: the picker now lives in a
							     quarter-width column, so it can't widen with the window. -->
							<div class="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto">
								{#each characters as character (character.slug)}
									<button
										type="button"
										class={classNames(
											'rounded-lg border-2 p-1 transition-colors',
											avatar === character.slug
												? 'border-primary'
												: 'hover:border-base-300 border-transparent'
										)}
										aria-pressed={avatar === character.slug}
										aria-label={character.name}
										title={character.name}
										onclick={() => (avatar = character.slug)}
									>
										<img src={character.src} alt="" class="h-auto w-full" />
									</button>
								{/each}
							</div>
						</div>

						<button class="btn btn-primary" disabled={!canSave || $player.saving} onclick={save}>
							Save
						</button>
					</section>
				{:else}
					<section
						class="border-base-300 bg-base-100/50 flex items-center gap-4 rounded-lg border p-3 backdrop-blur-md"
						aria-label="Player profile"
					>
						{#if selectedCharacter}
							<img
								src={selectedCharacter.src}
								alt={selectedCharacter.name}
								class="border-primary h-20 w-20 rounded-lg border-2"
							/>
						{/if}
						<div class="min-w-0 flex-1">
							<p class="text-base-content/50 text-xs tracking-wide uppercase">Player</p>
							<p class="truncate text-2xl font-bold">{profile?.name}</p>
						</div>
						<button class="btn btn-ghost btn-sm" onclick={edit}>Edit</button>
					</section>
				{/if}

				<section class="space-y-4" aria-label="Your decks">
					<a class="btn btn-primary btn-sm w-full" href="/decks">Build decks</a>

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
			</div>

			<!-- The middle two columns: the same pack opener the /booster page is, canvas
			     and all. It fills the two columns it spans and the full height of the
			     row, which is what gives the canvas something to size itself to. -->
			<section class="min-w-0 md:col-span-2" aria-label="Booster packs">
				<BoosterPackPanel
					pool={boosterPool}
					saving={$player.saving}
					onGrant={(cardIds) => playerService.grantCards(cardIds)}
					classes="h-full"
				/>
			</section>

			<section class="min-w-0" aria-label="Characters">
				<AssignedCharacterList
					entries={opponents}
					loading={opponentsLoading}
					{canChallenge}
					{challengeBlockedReason}
					onChallenge={challenge}
				/>
			</section>
		</div>
	{/if}
</main>
