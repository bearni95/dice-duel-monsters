import type { CardAsset } from "$components/cards/GameCard.svelte";
import { AdapterClass } from "./classes/adapter.class";

export interface IGameCreature{
    id: number;
		name: string;
		type: string;
		race: string;
		attribute: string;
		cardImages: { image_url_cropped: string }[];
		billboard?: string;

		// Per-card board positioning authored in the /admin/cards board-preview modal
		// and baked into the catalog. `size` scales the billboard (1 = default), while
		// `x`/`y` offset it (in world px) from its cell center. Absent means default
		// (size 1, no offset — the red and purple borders matching, centered).
		size?: number;
		x?: number;
		y?: number;


    atk: number
    // Pool of d6 rolled for the creature's HP total when it enters the board.
    hp: number
    def: number
    cost: number
    speed: number
    // How far the creature can strike, derived from its level: ceil(level / 4).
    reach: number
}
export class CreatureAdapter extends AdapterClass {
    constructor(){
        super('creature-adapter')
    }

    getTributesForLevel(level: number): 0 | 1 | 2 | 3 {
        if (level <= 4) return 0 
        if (level <=6) return 1 
        if (level <= 8) return 2
        return 3
    }

    // Whether a card can be represented as an in-game creature (i.e. it's a
    // monster with battle stats). Non-monster cards (spells, traps, …) are not.
    isMonster(card: CardAsset): boolean {
        return Boolean(card.atk || card.def || card.lvl);
    }

    // Produce an IGameCreature for *any* card so the shared card renderer can
    // display it. Monsters get their real derived stats; non-monster cards get a
    // zeroed placeholder (the renderer hides the stat overlays for them).
    getDisplayAttributes(card: CardAsset): IGameCreature {
        if (this.isMonster(card)) return this.getAttributes(card);
        return {
            id: card.id,
            name: card.name,
            type: card.type,
            race: card.race,
            attribute: card.attribute,
            cardImages: card.cardImages,
            billboard: card.billboard,
            size: card.size,
            x: card.x,
            y: card.y,
            atk: 0,
            hp: 0,
            def: 0,
            cost: 0,
            speed: 0,
            reach: 0
        };
    }

    getAttributes(card: CardAsset): IGameCreature {
        if (
            !card.atk &&
            !card.def &&
            !card.lvl 
        ){
            throw new Error ('Cannot convert non-monster card given ' + card.id)
        }
        return {
            id: card.id, 
            name: card.name,
            type: card.type,
            race: card.race, 
            attribute: card.attribute,
            cardImages: card.cardImages,
            billboard: card.billboard,
            size: card.size,
            x: card.x,
            y: card.y,
            // Yugioh 0-atk / 0-def monsters are treated as 100 for the stat
            // conversion, so a 0 defense doesn't collapse a creature to 0 HP.
            // `hp` is a pool of d6 that gets rolled into an actual HP total once
            // the creature is summoned onto the board. It's half the atk-style
            // conversion (so creatures get half as many HP dice as before), with
            // a floor of 1 die so nothing enters the board with a 0 HP pool.
            atk: Math.round((card.atk || 100) / 200),
            hp:  Math.max(1, Math.round((card.def || 100) / 400)),
            def: 3 + this.getTributesForLevel(card.lvl || 0),
            cost: card.lvl || 1,
            speed: 1 + (card.lvl || 0),
            // Reach scales with level in bands of four: levels 1–4 reach 1,
            // 5–8 reach 2, and so on.
            reach: Math.ceil((card.lvl || 0) / 4)
        }
    }
}