import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

// Declared through `vi.hoisted` so the mock factories below (which are hoisted
// above every import) can reach it — including above `svelte/store`, which is
// why the auth store here is hand-rolled rather than a `writable`.
const mocks = vi.hoisted(() => {
	// The signed-in player the service follows. It only ever subscribes, and the
	// session never changes during a test.
	const authStore = {
		subscribe(run: (value: { user: { id: string } | null; loading: boolean }) => void) {
			run({ user: { id: 'player-1' }, loading: false });
			return () => {};
		}
	};

	// One resolver per outstanding `rpc` call, so a test can hold a write open and
	// watch what the service does with the edits that arrive meanwhile.
	const rpcCalls: { args: Record<string, unknown>; settle: (result: unknown) => void }[] = [];

	const rpc = vi.fn((_fn: string, args: Record<string, unknown>) => {
		return new Promise((resolve) => {
			rpcCalls.push({ args, settle: resolve });
		});
	});

	// What the fake database hands back when the service (re)reads the decks.
	const server = {
		decks: [] as { id: string; name: string; enabled: boolean }[],
		cards: [] as { deck_id: string; card_id: number; quantity: number }[]
	};

	// Row updates the service writes directly (the enabled flag), and what the
	// database says about them — a test sets `updateError` to have one refused.
	const updates: { table: string; values: Record<string, unknown>; id: unknown }[] = [];
	const updateError = { message: null as string | null };

	const client = {
		rpc,
		from(table: string) {
			return {
				select: () => ({
					eq: () => {
						const rows = table === 'player_decks' ? server.decks : server.cards;
						const result = Promise.resolve({ data: rows, error: null });
						// The decks query adds `.order()`; the cards query doesn't.
						return Object.assign(result, { order: () => result });
					}
				}),
				update: (values: Record<string, unknown>) => ({
					eq: (_column: string, id: unknown) => {
						updates.push({ table, values, id });
						return Promise.resolve({
							error: updateError.message ? { message: updateError.message } : null
						});
					}
				}),
				delete: () => ({ eq: () => Promise.resolve({ error: null }) })
			};
		}
	};

	return { authStore, rpcCalls, rpc, server, client, updates, updateError };
});

vi.mock('$services/auth.service', () => ({
	authService: { store: mocks.authStore, configured: true }
}));

vi.mock('$utils/supabase/client', () => ({
	isSupabaseConfigured: true,
	getSupabaseClient: () => mocks.client
}));

const { playerDeckService } = await import('$services/player-deck.service');

/** Let queued promise callbacks run before asserting on what they did. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Settle the oldest outstanding `rpc` call as a success returning `data`. */
async function settleWrite(data: unknown = null) {
	mocks.rpcCalls.shift()?.settle({ data, error: null });
	await flush();
}

/** Settle the oldest outstanding `rpc` call as a rejection by the database. */
async function failWrite(message: string) {
	mocks.rpcCalls.shift()?.settle({ data: null, error: { message } });
	await flush();
}

describe('playerDeckService', () => {
	beforeEach(async () => {
		// The load kicked off when the service first saw the session resolves on its
		// own schedule; let it land before each test resets the store under it.
		await flush();

		// The service is a singleton, so a write a test deliberately left open would
		// still be holding its deck when the next one runs. Settle whatever is
		// outstanding — including anything those settlements queue up — first.
		while (mocks.rpcCalls.length > 0) {
			mocks.rpcCalls.shift()?.settle({ data: null, error: null });
			await flush();
		}

		mocks.rpcCalls.length = 0;
		mocks.rpc.mockClear();
		mocks.server.decks = [];
		mocks.server.cards = [];
		mocks.updates.length = 0;
		mocks.updateError.message = null;
		playerDeckService.store.set({ decks: [], loading: false, saving: false, error: null });
	});

	describe('create', () => {
		it('adds the new empty deck to the store and returns its id', async () => {
			const created = playerDeckService.create();
			await flush();

			expect(mocks.rpc).toHaveBeenCalledWith(
				'save_player_deck',
				expect.objectContaining({ p_deck_id: null, p_entries: [] })
			);

			await settleWrite('deck-1');

			expect(await created).toBe('deck-1');
			expect(get(playerDeckService.store).decks).toEqual([
				{ id: 'deck-1', name: '', cards: [], enabled: false }
			]);
		});

		it('reports a refused creation on the store rather than throwing', async () => {
			const created = playerDeckService.create();
			await flush();
			await failWrite('not authenticated');

			expect(await created).toBeNull();
			expect(get(playerDeckService.store).error).toBe('not authenticated');
			expect(get(playerDeckService.store).decks).toEqual([]);
		});
	});

	describe('update', () => {
		beforeEach(() => {
			playerDeckService.store.set({
				decks: [{ id: 'deck-1', name: 'Draft', cards: [], enabled: false }],
				loading: false,
				saving: false,
				error: null
			});
		});

		it('applies the edit to the store before the write lands', () => {
			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 1 }] });

			expect(get(playerDeckService.store).decks[0].cards).toEqual([{ cardId: 10, quantity: 1 }]);
			expect(get(playerDeckService.store).saving).toBe(true);
		});

		it('coalesces edits made while a write is in flight into one follow-up write', async () => {
			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 1 }] });
			await flush();
			expect(mocks.rpc).toHaveBeenCalledTimes(1);

			// Three more clicks land while that first write is still open.
			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 2 }] });
			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 3 }] });
			playerDeckService.update('deck-1', { name: 'Burn' });
			expect(mocks.rpc).toHaveBeenCalledTimes(1);

			await settleWrite();

			// One follow-up write, carrying only the final state.
			expect(mocks.rpc).toHaveBeenCalledTimes(2);
			expect(mocks.rpc).toHaveBeenLastCalledWith('save_player_deck', {
				p_deck_id: 'deck-1',
				p_name: 'Burn',
				p_entries: [{ card_id: 10, quantity: 3 }]
			});

			await settleWrite();
			expect(mocks.rpc).toHaveBeenCalledTimes(2);
			expect(get(playerDeckService.store).saving).toBe(false);
		});

		it('resyncs from the server and reports the reason when a write is refused', async () => {
			mocks.server.decks = [{ id: 'deck-1', name: 'Draft', enabled: false }];
			mocks.server.cards = [{ deck_id: 'deck-1', card_id: 10, quantity: 1 }];

			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 3 }] });
			await flush();
			await failWrite('a deck cannot hold more copies of a card than you own');

			const state = get(playerDeckService.store);
			expect(state.error).toBe('a deck cannot hold more copies of a card than you own');
			expect(state.decks).toEqual([
				{ id: 'deck-1', name: 'Draft', cards: [{ cardId: 10, quantity: 1 }], enabled: false }
			]);
			expect(state.saving).toBe(false);
		});

		it('drops edits queued behind a refused write instead of writing over it', async () => {
			mocks.server.decks = [{ id: 'deck-1', name: 'Draft', enabled: false }];

			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 1 }] });
			await flush();
			playerDeckService.update('deck-1', { cards: [{ cardId: 10, quantity: 2 }] });

			await failWrite('a deck may hold at most 30 cards');

			expect(mocks.rpc).toHaveBeenCalledTimes(1);
			expect(get(playerDeckService.store).decks[0].cards).toEqual([]);
		});

		it('ignores an edit to a deck that is no longer in the store', () => {
			playerDeckService.update('gone', { name: 'Nowhere' });

			expect(mocks.rpc).not.toHaveBeenCalled();
			expect(get(playerDeckService.store).decks).toHaveLength(1);
		});
	});

	describe('setEnabled', () => {
		beforeEach(() => {
			playerDeckService.store.set({
				decks: [
					{ id: 'deck-1', name: 'Burn', cards: [], enabled: true },
					{ id: 'deck-2', name: 'Control', cards: [], enabled: false }
				],
				loading: false,
				saving: false,
				error: null
			});
		});

		it('flips the flag on the store and writes it to the deck row', async () => {
			const done = playerDeckService.setEnabled('deck-2', true);

			// Applied before the write lands, so the switch never lags the click.
			expect(get(playerDeckService.store).decks[1].enabled).toBe(true);

			await done;

			// The deck that held the flag is stood down first, then the new one takes
			// it — one row update each.
			expect(mocks.updates).toEqual([
				{ table: 'player_decks', values: { enabled: false }, id: 'deck-1' },
				{ table: 'player_decks', values: { enabled: true }, id: 'deck-2' }
			]);
			// The flag is its own row update; a deck's 30 cards aren't rewritten for it.
			expect(mocks.rpc).not.toHaveBeenCalled();
		});

		it('stands the active deck down when another one takes over', async () => {
			await playerDeckService.setEnabled('deck-2', true);

			const decks = get(playerDeckService.store).decks;
			expect(decks[0].enabled).toBe(false);
			expect(decks[1].enabled).toBe(true);
		});

		it('leaves the other decks alone when a deck stands itself down', async () => {
			await playerDeckService.setEnabled('deck-1', false);

			expect(mocks.updates).toEqual([
				{ table: 'player_decks', values: { enabled: false }, id: 'deck-1' }
			]);
			expect(get(playerDeckService.store).decks.map((deck) => deck.enabled)).toEqual([
				false,
				false
			]);
		});

		it('puts the flag back and reports the reason when the write is refused', async () => {
			mocks.updateError.message = 'permission denied';

			await playerDeckService.setEnabled('deck-2', true);

			const state = get(playerDeckService.store);
			expect(state.decks[1].enabled).toBe(false);
			expect(state.error).toBe('permission denied');
		});

		it('leaves the active deck standing when it cannot be stood down', async () => {
			mocks.updateError.message = 'permission denied';

			await playerDeckService.setEnabled('deck-2', true);

			const state = get(playerDeckService.store);
			expect(state.decks[0].enabled).toBe(true);
			// The refusal came from the stand-down, so the deck taking over is never
			// written at all.
			expect(mocks.updates).toEqual([
				{ table: 'player_decks', values: { enabled: false }, id: 'deck-1' }
			]);
		});

		it('writes nothing when the flag already has the requested value', async () => {
			await playerDeckService.setEnabled('deck-1', true);

			expect(mocks.updates).toEqual([]);
		});
	});
});
