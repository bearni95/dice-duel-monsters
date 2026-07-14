import type { CardAsset } from "$components/cards/GameCard.svelte";
import { AdapterClass } from "./classes/adapter.class";

export interface IGameCreature{
    id: number;
		name: string;
		type: string;
		race: string;
		attribute: string;
		cardImages: { image_url_cropped: string }[];


    atk: number 
    hp: number
    def: number
    cost: number
    speed: number
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
            atk: Math.round((card.atk || 0 )/ 200),
            hp:  Math.round((card.def || 0)/ 50),
            def: 3 + this.getTributesForLevel(card.lvl || 0),
            cost: card.lvl || 1,
            speed: 1 + (card.lvl || 0)
        }
    }
}