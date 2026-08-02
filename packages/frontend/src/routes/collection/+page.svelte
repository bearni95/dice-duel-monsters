<script lang="ts">
	import { authService } from '$services/auth.service';
	import { collectionService } from '$services/collection.service';

	// What the player owns, over the scattered-cards backdrop the layout draws
	// behind every page. The counts come from the same store that feeds it, so the
	// numbers here always describe exactly what's on screen.
	const auth = authService.store;
	const collection = collectionService.store;
</script>

<svelte:head>
	<title>Collection · Dice Guardians</title>
</svelte:head>

<main class="relative mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center p-4">
	{#if !authService.configured}
		<section class="space-y-2 py-8 text-center" aria-label="Sign in required">
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/60 text-sm">
				Your collection is saved to your account, but Supabase isn't configured for this build.
			</p>
		</section>
	{:else if $auth.loading || ($auth.user && $collection.loading)}
		<section class="flex items-center justify-center py-16" aria-label="Loading">
			<span class="loading loading-spinner loading-lg text-primary"></span>
		</section>
	{:else if !$auth.user}
		<section class="space-y-6 py-8 text-center" aria-label="Sign in">
			<div class="space-y-2">
				<h1 class="text-2xl font-bold">Collection</h1>
				<p class="text-base-content/60 text-sm">Sign in with Discord to see your cards.</p>
			</div>
			<button class="btn btn-primary" onclick={() => authService.signInWithDiscord()}>
				Continue with Discord
			</button>
		</section>
	{:else if $collection.cards.length === 0}
		<section class="space-y-2 py-8 text-center" aria-label="Empty collection">
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/60 text-sm">
				You don't own any cards yet. Grab some on the
				<a class="link link-primary" href="/">home page</a> and they'll show up here.
			</p>
		</section>
	{:else}
		<!-- Sits over the cards, so it gets a translucent panel rather than
		     competing with the art behind it. -->
		<section
			class="bg-base-100/70 border-base-300/60 space-y-1 rounded-xl border px-6 py-5 text-center shadow-xl backdrop-blur-sm"
			aria-label="Collection"
		>
			<h1 class="text-2xl font-bold">Collection</h1>
			<p class="text-base-content/70 text-sm">
				{$collection.cardIds.length}
				{$collection.cardIds.length === 1 ? 'card' : 'cards'} · {$collection.cards.length} unique
			</p>
			<p class="text-base-content/50 text-xs">Move your cursor through them.</p>
		</section>
	{/if}
</main>
