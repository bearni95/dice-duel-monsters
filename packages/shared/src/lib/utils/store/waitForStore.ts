import type { Readable } from 'svelte/store';

/**
 * Resolve with the first value of `store` that satisfies `predicate`.
 *
 * Svelte stores call a new subscriber with the current value straight away, so a
 * store that already satisfies the predicate resolves without waiting a tick —
 * and without ever leaving a subscription behind (the flag covers unsubscribing
 * from inside that synchronous first call, where `unsubscribe` isn't assigned
 * yet).
 *
 * Used to await state that loads on its own schedule — the signed-in player's
 * decks, say — from imperative code that can't subscribe reactively.
 */
export function waitForStore<T>(store: Readable<T>, predicate: (value: T) => boolean): Promise<T> {
	return new Promise<T>((resolve) => {
		let done = false;
		let unsubscribe: (() => void) | undefined;

		unsubscribe = store.subscribe((value) => {
			if (done || !predicate(value)) return;
			done = true;
			resolve(value);
			unsubscribe?.();
		});

		if (done) unsubscribe();
	});
}
