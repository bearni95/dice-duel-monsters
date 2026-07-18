import type { CardAsset } from "$components/cards/GameCard.svelte";
import type { CardDetail } from "$types/card.type";
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

			if (p === 1) {
				this.page = 1;
			}

            return {
                availableTypes: (data.availableTypes ?? []) as string[],
                availableAttributes: (data.availableAttributes ?? []) as string[],
                availableRaces: (data.availableRaces ?? []) as string[]
            }

    }

    // Load a page of the raw card catalog (monsters *and* non-monsters) plus the
    // filter facets, without converting to creatures. Monsters only appear once
    // they have a cutout (billboard); every other card type always shows.
    // Card types are filtered as a top-level `category` (monster/spell/trap) plus
    // a `subType` sub-categorization within it (monster variety, or spell/trap race).
    async loadCatalog(
        p: number,
        q: string = '',
        category: string = 'all',
        subType: string = 'all',
        attr: string = 'all',
        race: string = 'all'
    ) {
        const params = new URLSearchParams({
            limit: String(this.limit),
            offset: String((p - 1) * this.limit)
        });
        if (q.trim()) params.set('q', q.trim());
        if (category !== 'all') params.set('category', category);
        if (subType !== 'all') params.set('subType', subType);
        if (attr !== 'all') params.set('attribute', attr);
        if (race !== 'all') params.set('race', race);
        params.set('monsterCutout', 'true');

        const res = await fetch(`/database/cards?${params}`);
        const data = await res.json();

        return {
            cards: (data.cards ?? []) as CardAsset[],
            total: (data.total ?? 0) as number,
            availableAttributes: (data.availableAttributes ?? []) as string[],
            availableRaces: (data.availableRaces ?? []) as string[],
            monsterTypes: (data.monsterTypes ?? []) as string[],
            spellTypes: (data.spellTypes ?? []) as string[],
            trapTypes: (data.trapTypes ?? []) as string[]
        };
    }

    // Resolve a list of card ids into their raw card assets, preserving the order
    // they appear in and keeping duplicates so deck copy counts survive. Only
    // playable cards come back: vanilla monsters and plain Effect Monsters, plus
    // any other card (gimmick monster, spell, or trap) that has an effect assigned
    // — the server applies this filter via `playable=true`, so special-summon
    // monsters and effectless spell/traps drop out. Used to render a deck's full
    // contents through the shared CardTile renderer.
    async loadCardAssetsByIds(ids: number[], forcedIds: number[] = []): Promise<CardAsset[]> {
        const uniqueIds = [...new Set(ids)];
        if (!uniqueIds.length) return [];

        const params = new URLSearchParams({ ids: uniqueIds.join(','), playable: 'true' });
        // Forced ids override the playable verdict for this deck's cards.
        if (forcedIds.length) params.set('force', [...new Set(forcedIds)].join(','));
        const res = await fetch(`/database/cards?${params}`);
        if (!res.ok) throw new Error(`Could not load cards (${res.status})`);
        const data = await res.json();

        const byId = new Map<number, CardAsset>();
        for (const c of data.cards as CardAsset[]) byId.set(c.id, c);

        return ids.map((id) => byId.get(id)).filter((c): c is CardAsset => Boolean(c));
    }

    // Resolve a list of card ids into every card that exists in the local DB,
    // preserving order and duplicates, each tagged with whether it is `playable`
    // (the same vanilla-monster / assigned-effect rule the deck previews apply via
    // `playable=true`). Cards that are missing from the DB entirely are dropped;
    // cards that exist but are not playable come back with `playable: false` so the
    // deck editor can render them disabled instead of hiding them.
    async loadDeckEditorCards(
        ids: number[]
    ): Promise<Array<{ card: CardAsset; playable: boolean }>> {
        const uniqueIds = [...new Set(ids)];
        if (!uniqueIds.length) return [];

        const idsParam = uniqueIds.join(',');
        const [allRes, playableRes] = await Promise.all([
            fetch(`/database/cards?ids=${idsParam}`),
            fetch(`/database/cards?ids=${idsParam}&playable=true`)
        ]);
        if (!allRes.ok) throw new Error(`Could not load cards (${allRes.status})`);
        if (!playableRes.ok) throw new Error(`Could not load cards (${playableRes.status})`);

        const allData = await allRes.json();
        const playableData = await playableRes.json();

        const byId = new Map<number, CardAsset>();
        for (const c of allData.cards as CardAsset[]) byId.set(c.id, c);
        const playableIds = new Set<number>((playableData.cards as CardAsset[]).map((c) => c.id));

        return ids
            .map((id) => byId.get(id))
            .filter((c): c is CardAsset => Boolean(c))
            .map((card) => ({ card, playable: playableIds.has(card.id) }));
    }

    // Load the complete record for a single card, with every field available in
    // the source data. Used by the card detail modal.
    async loadDetail(id: number): Promise<CardDetail> {
        const res = await fetch(`/database/cards/${id}`);
        if (!res.ok) throw new Error(`Could not load card ${id} (${res.status})`);
        const data = await res.json();
        return data.card as CardDetail;
    }

    // Resolve a list of card ids (e.g. the player's deck) into monster
    // creatures, preserving the order they appear in and skipping duplicates
    // and non-monster cards. Pass `playableOnly` to also apply the server's
    // `playable=true` filter, so only playable creatures (vanilla monsters, plain
    // Effect Monsters, and gimmick monsters with an assigned effect) come back
    // (used by the board, which only summons playable creatures).
    async loadByIds(
        ids: number[],
        playableOnly = false,
        forcedIds: number[] = []
    ): Promise<IGameCreature[]> {
        this.loading = true;
        try {
            const uniqueIds = [...new Set(ids)];
            if (!uniqueIds.length) {
                this.cards = [];
                return this.cards;
            }

            const params = new URLSearchParams({ ids: uniqueIds.join(',') });
            if (playableOnly) {
                params.set('playable', 'true');
                // Forced ids override the playable verdict for this deck's cards.
                if (forcedIds.length) params.set('force', [...new Set(forcedIds)].join(','));
            }
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