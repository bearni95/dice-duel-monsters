/**
 * Full Yu-Gi-Oh! card record as stored in static/cards/cardinfo.json.
 *
 * The grid endpoint returns only a lightweight subset for rendering tiles; this
 * is the complete shape served by the card-detail endpoint (/database/cards/[id])
 * and rendered in the card detail modal.
 */

/** A printing of a card in a specific set. */
export interface CardSet {
	set_name: string;
	set_code: string;
	set_rarity: string;
	set_rarity_code: string;
	set_price: string;
}

/** An artwork variant with its hosted image URLs. */
export interface CardImage {
	id: number;
	image_url: string;
	image_url_small: string;
	image_url_cropped: string;
}

/** Marketplace prices for a card. */
export interface CardPrices {
	cardmarket_price: string;
	tcgplayer_price: string;
	ebay_price: string;
	amazon_price: string;
	coolstuffinc_price: string;
}

/** The complete card record, with every field available in the source data. */
export interface CardDetail {
	id: number;
	name: string;
	typeline?: string[];
	type: string;
	humanReadableCardType?: string;
	frameType?: string;
	desc?: string;
	race: string;
	atk?: number;
	def?: number;
	level?: number;
	attribute?: string;
	ygoprodeck_url?: string;
	card_sets?: CardSet[];
	card_images?: CardImage[];
	card_prices?: CardPrices[];
	billboard?: string;
}
