import { get, writable, type Writable } from 'svelte/store';
import { playerService } from '$services/player.service';
import { CardApiAdapter } from '$adapters/cardApi.adapter';
import type { CardAsset } from '$components/cards/GameCard.svelte';
import type { PlayerState } from '$types/player.type';

export interface CollectionState {
	/** The distinct cards owned, with copy counts, in first-owned order. */
	cards: { card: CardAsset; count: number }[];
	/** The same collection as one id per copy, oldest first. */
	cardIds: number[];
	/** True until the collection has settled: the player is loading, or a resolve is in flight. */
	loading: boolean;
}

const EMPTY: CollectionState = { cards: [], cardIds: [], loading: false };

/**
 * The signed-in player's collection, resolved against the card catalog.
 *
 * `playerService` holds the raw owned ids; this turns them into cards that can
 * actually be drawn — `ownedUnique` drops ids outside the grantable allow-list,
 * so cards granted under older rules (with no committed art behind them) never
 * reach the UI. Every consumer used to run that resolve itself; keeping it here
 * means one catalog read per ownership change no matter how many views are
 * listening, which matters now that the backdrop makes it every page.
 *
 * Follows `playerService` automatically, so it reloads on sign-in and empties on
 * sign-out. Components read `collectionService.store` and nothing else.
 */
class CollectionService {
	store: Writable<CollectionState>;

	private adapter = new CardApiAdapter();

	// The owned ids the store currently reflects, so a player update that doesn't
	// touch ownership (a profile save, say) doesn't trigger a fresh resolve.
	private ownedKey: string | null = null;

	// Guards against a slow resolve overwriting a newer one, and tracks whether one
	// is still running so `loading` can cover the gap between the player's cards
	// arriving and the catalog resolving them.
	private token = 0;
	private resolving = false;

	constructor() {
		this.store = writable<CollectionState>({ ...EMPTY });
		playerService.store.subscribe((player) => this.sync(player));
	}

	private sync(player: PlayerState): void {
		const key = player.cards.join(',');
		if (key !== this.ownedKey) {
			this.ownedKey = key;
			this.resolve(player.cards);
		}
		const loading = player.loading || this.resolving;
		this.store.update((state) => (state.loading === loading ? state : { ...state, loading }));
	}

	private resolve(ownedIds: number[]): void {
		const token = ++this.token;

		if (ownedIds.length === 0) {
			this.resolving = false;
			this.store.set({ ...EMPTY });
			return;
		}

		this.resolving = true;
		this.adapter
			.ownedUnique(ownedIds)
			.then((cards) => {
				if (token !== this.token) return;
				this.resolving = false;
				this.store.set({ cards, cardIds: this.expand(cards), loading: false });
			})
			.catch(() => {
				// A catalog that failed to load leaves the collection empty rather than
				// stuck loading; the next ownership change retries.
				if (token !== this.token) return;
				this.resolving = false;
				this.store.set({ ...EMPTY });
			});
	}

	// Distinct cards back to one id per copy, oldest first — the order the backdrop
	// wants, where the newest copies survive its cap and paint on top.
	private expand(cards: { card: CardAsset; count: number }[]): number[] {
		const ids: number[] = [];
		for (const { card, count } of cards) {
			for (let i = 0; i < count; i++) ids.push(card.id);
		}
		return ids;
	}

	/** The current collection snapshot. */
	get(): CollectionState {
		return get(this.store);
	}
}

export const collectionService = new CollectionService();
