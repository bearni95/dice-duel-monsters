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

    async load(p: number, q: string = '', type: string = 'all', attr: string = 'all', race: string = 'all') {
		this.loading = true;
			const params = new URLSearchParams({
				limit: String(this.limit),
				offset: String((p - 1) * this.limit),
			});
			if (q.trim()) params.set('q', q.trim());
			if (type !== 'all') params.set('type', type);
			if (attr !== 'all') params.set('attribute', attr);
			if (race !== 'all') params.set('race', race);

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
}