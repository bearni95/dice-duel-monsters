import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { waitForStore } from '$utils/store/waitForStore';

describe('waitForStore', () => {
	it('resolves with the current value when it already matches', async () => {
		const store = writable({ loading: false, value: 'ready' });

		await expect(waitForStore(store, (state) => !state.loading)).resolves.toEqual({
			loading: false,
			value: 'ready'
		});
	});

	it('waits for the first value that matches', async () => {
		const store = writable({ loading: true, value: '' });
		const settled = vi.fn();

		const waiting = waitForStore(store, (state) => !state.loading).then(settled);

		store.set({ loading: true, value: 'still going' });
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();

		store.set({ loading: false, value: 'done' });
		await waiting;

		expect(settled).toHaveBeenCalledWith({ loading: false, value: 'done' });
	});

	it('unsubscribes once it has resolved, whether it waited or not', async () => {
		// Hand-rolled rather than a `writable` so the subscription is observable:
		// what matters is that nothing is left listening to a store that keeps
		// changing long after the caller stopped caring.
		let subscribers = 0;
		let push: ((value: number) => void) | null = null;
		const store = {
			subscribe(run: (value: number) => void) {
				subscribers++;
				push = run;
				run(0);
				return () => {
					subscribers--;
				};
			}
		};

		await waitForStore(store, (value) => value === 0);
		expect(subscribers).toBe(0);

		const waiting = waitForStore(store, (value) => value === 2);
		push!(1);
		push!(2);
		await waiting;

		expect(subscribers).toBe(0);
	});
});
