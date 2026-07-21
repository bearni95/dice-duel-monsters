import type { CardAsset } from '$components/cards/GameCard.svelte';
import { CreatureAdapter } from '$adapters/creature.adapter';
import { renderCardToPng } from '$utils/card/cardToPng';

// Client-side, throttled generator for the /admin/print PNGs. A card tile whose
// baked PNG is missing (the /admin/print endpoint 404s) asks this queue to produce
// it: the card is rasterized off-screen (renderCardToPng) and POSTed to
// /admin/print/save, which writes it under static/cards/generated so the endpoint
// serves it thereafter.
//
// This is what replaced the old "one <iframe src=/admin/print> per card" approach:
// every tile used to boot a whole SPA (app + 3.6MB catalog + canvas) in its own
// document. Here all rendering happens in the *single* page that owns the tiles,
// capped at MAX_CONCURRENT at a time, so a deck of dozens of cards can't stampede
// the dev server (which is what made asset fetches fail and bake blank cards).

// Output width of the produced PNG (the full-size /admin/print output).
const OUTPUT_WIDTH = 1080;

// How many cards may rasterize + save at once. Small on purpose: the bottleneck is
// the per-render burst of asset fetches (card art via the proxy, icons), and
// overlapping too many is exactly what starved them before.
const MAX_CONCURRENT = 2;

const creatureAdapter = new CreatureAdapter();

// A tiny counting semaphore so no more than MAX_CONCURRENT renders run at once.
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
	return new Promise((resolve) => {
		const run = () => {
			if (active < MAX_CONCURRENT) {
				active++;
				resolve();
			} else {
				waiters.push(run);
			}
		};
		run();
	});
}

function release(): void {
	active--;
	waiters.shift()?.();
}

// Cards whose generation is in flight or already done this session, so several
// tiles referencing the same card (and a card's own reload) don't render it twice.
// A failed attempt is evicted so it can be retried.
const inFlight = new Map<string, Promise<void>>();

async function generate(card: CardAsset): Promise<void> {
	await acquire();
	try {
		const creature = creatureAdapter.getDisplayAttributes(card);
		const png = await renderCardToPng(creature, {
			width: OUTPUT_WIDTH,
			showStats: creatureAdapter.isMonster(card)
		});

		const res = await fetch('/admin/print/save', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// failedAssets lets the server refuse to bake a card with missing art and
			// log why, rather than persisting a blank PNG that would be served forever.
			body: JSON.stringify({
				id: card.id,
				dataUrl: png.dataUrl,
				failedAssets: png.failedAssets
			})
		});

		const info = await res.json().catch(() => null);
		if (!res.ok) throw new Error(`save ${card.id} → ${res.status}`);
		if (info && info.saved === false) {
			// Server declined to persist (assets failed to inline). Surface it so the
			// tile shows its placeholder instead of pretending the PNG now exists.
			throw new Error(`card ${card.id} not baked: ${(info.failedAssets ?? []).join(', ')}`);
		}
	} finally {
		release();
	}
}

// Ensure `card`'s PNG is generated and saved. Resolves once it is on disk (so the
// caller can reload the image), rejects if it could not be baked.
export function enqueueCardGeneration(card: CardAsset): Promise<void> {
	const key = String(card.id);
	let pending = inFlight.get(key);
	if (!pending) {
		pending = generate(card).catch((err) => {
			inFlight.delete(key);
			throw err;
		});
		inFlight.set(key, pending);
	}
	return pending;
}
