import type { CardAsset } from "$components/cards/GameCard.svelte";
import { AdapterClass } from "./classes/adapter.class";
import { CreatureAdapter, type IGameCreature } from "./creature.adapter";

export class CardApiAdapter extends AdapterClass {
    limit = 100
    loading = false
    totalCards = 0
	page = 0
    creatureAdapter = new CreatureAdapter()
    cards: IGameCreature[] = []

    constructor(){
        super('card-api-adapter')
    }

    async load(p: number, q: string = '', type: string = 'all', attr: string = 'all', race: string = 'all', billboard: boolean = false) {
		this.loading = true;
			const params = new URLSearchParams({
				limit: String(this.limit),
				offset: String((p - 1) * this.limit),
			});
			if (q.trim()) params.set('q', q.trim());
			if (type !== 'all') params.set('type', type);
			if (attr !== 'all') params.set('attribute', attr);
			if (race !== 'all') params.set('race', race);
			if (billboard) params.set('billboard', 'true');

			const res = await fetch(`/database/cards?${params}`);
			const data = await res.json();
			this.cards = data.cards.filter((c:CardAsset) => c.lvl).map((c: CardAsset) => this.creatureAdapter.getAttributes(c))
			console.log('data.cards', data.cards)
			this.totalCards = data.total;
			const filterableTypes = data.availableTypes;
		const	filterableAttributes = data.availableAttributes;
	const	filterableRaces = data.availableRaces;

			if (p === 1) {
				this.page = 1;
			}

            return {
                filterableTypes, filterableAttributes, filterableRaces
            }

    }

    // Resolve a list of card ids (e.g. the player's deck) into monster
    // creatures, preserving the order they appear in and skipping duplicates
    // and non-monster cards.
    async loadByIds(ids: number[]): Promise<IGameCreature[]> {
        this.loading = true;
        try {
            const uniqueIds = [...new Set(ids)];
            if (!uniqueIds.length) {
                this.cards = [];
                return this.cards;
            }

            const params = new URLSearchParams({ ids: uniqueIds.join(',') });
            const res = await fetch(`/database/cards?${params}`);
            const data = await res.json();

            const byId = new Map<number, CardAsset>();
            for (const c of data.cards as CardAsset[]) byId.set(c.id, c);

            this.cards = uniqueIds
                .map((id) => byId.get(id))
                .filter((c): c is CardAsset => Boolean(c?.lvl))
                .map((c) => this.creatureAdapter.getAttributes(c));

            return this.cards;
        } finally {
            this.loading = false;
        }
    }
}