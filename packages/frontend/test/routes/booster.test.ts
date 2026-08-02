import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import type { BoosterPackOpenerCallbacks } from '$components/booster/scene/BoosterPackOpenerScene';

// The one thing this page has to get right around the canvas: "Open another" is
// dead until the pack on screen has actually been opened, and goes dead again the
// moment it is used. The canvas itself is stubbed out — the scene is Pixi and
// needs a GPU — but the stub hands back the real `onOpenComplete` callback, so
// the cycle asserted here is the one the real scene drives.
const harness = vi.hoisted(() => ({
	callbacks: null as BoosterPackOpenerCallbacks | null,
	grantCards: vi.fn(async (_cardIds: number[]) => {}),
	player: null as ReturnType<typeof import('svelte/store').writable> | null
}));

vi.mock('$components/booster/scene/BoosterPackOpenerScene', () => ({
	BoosterPackOpenerScene: class {
		constructor(
			_host: HTMLElement,
			_pack: unknown,
			_coverUrl: unknown,
			_pulls: unknown,
			callbacks: BoosterPackOpenerCallbacks
		) {
			harness.callbacks = callbacks;
		}
		destroy() {}
		adjustCut() {}
		triggerCut() {}
		get keyboardCutStep() {
			return 12;
		}
	}
}));

// Pulls pixi.js in at import time, and nothing here needs a texture.
vi.mock('$utils/booster/packTextures', () => ({
	packCoverUrl: () => '/cards/monster-billboards/cover.png',
	cardArtUrl: (id: number) => `/cards/generated/${id}.png`,
	loadTexture: async () => null,
	cachedTexture: () => null
}));

vi.mock('$services/auth.service', () => ({
	authService: {
		configured: true,
		store: writable({ user: { id: 'u1', name: 'Player', avatar: null }, loading: false }),
		signInWithDiscord: vi.fn(),
		signOut: vi.fn()
	}
}));

vi.mock('$services/player.service', () => {
	const store = writable({ profile: null, cards: [], loading: false, saving: false });
	harness.player = store;
	return { playerService: { store, grantCards: harness.grantCards } };
});

vi.mock('$adapters/cardApi.adapter', () => ({
	CardApiAdapter: class {
		async loadBoosterPool() {
			// Enough distinct ATK values that a pack fills every slot from a real pool.
			return Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				name: `Card ${i + 1}`,
				type: 'Effect Monster',
				race: 'Warrior',
				attribute: 'DARK',
				cardImages: [{ image_url_cropped: '' }],
				atk: i * 200
			}));
		}
	}
}));

import Page from '../../src/routes/booster/+page.svelte';

function openAnother(): HTMLButtonElement {
	return screen.getByRole('button', { name: /open another/i }) as HTMLButtonElement;
}

// The canvas reports the cards as settled, which is what makes the pack "opened".
async function finishOpening() {
	harness.callbacks?.onOpenComplete?.();
	await waitFor(() => expect(openAnother()).toBeEnabled());
}

describe('/booster', () => {
	it('starts with Open another disabled and enables it once the pack is opened', async () => {
		render(Page);

		// The button only exists once the pool has loaded and a pack has been rolled.
		await waitFor(() => expect(openAnother()).toBeDisabled());

		await finishOpening();
		expect(openAnother()).toBeEnabled();
	});

	it('grants the nine pulled cards when the pack finishes opening', async () => {
		render(Page);
		await waitFor(() => expect(openAnother()).toBeDisabled());

		await finishOpening();

		expect(harness.grantCards).toHaveBeenCalledTimes(1);
		expect(harness.grantCards.mock.calls[0][0]).toHaveLength(9);
	});

	it('disables Open another again on click, until the next pack is opened', async () => {
		render(Page);
		await waitFor(() => expect(openAnother()).toBeDisabled());
		await finishOpening();

		openAnother().click();

		await waitFor(() => expect(openAnother()).toBeDisabled());

		// And the fresh canvas re-enables it the same way the first one did.
		await finishOpening();
		expect(openAnother()).toBeEnabled();
	});

	it('stays disabled while the collection is being written', async () => {
		render(Page);
		await waitFor(() => expect(openAnother()).toBeDisabled());
		await finishOpening();

		// A save in flight elsewhere must not let a second pack be rolled on top of it.
		harness.player?.set({ profile: null, cards: [], loading: false, saving: true });
		await waitFor(() => expect(openAnother()).toBeDisabled());
	});
});
