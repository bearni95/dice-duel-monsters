import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = '/database/cards from static/cards/cardinfo.json';

type CardItem = {
	id: number;
	name: string;
	type: string;
	race: string;
	attribute: string | undefined;
	cardImages: { image_url_cropped: string }[];
	billboard?: string
	atk?: number
	def?: number
	lvl?: number
};

type CardResponse = {
	cards: Omit<CardItem, 'desc'>[];
	total: number;
	availableTypes: string[];
	availableAttributes: string[];
	availableRaces: string[];
	source: typeof SOURCE;
};

export const GET: RequestHandler = async ({ url }) => {
	const limit = parseInt(url.searchParams.get('limit') || '50');
	const offset = parseInt(url.searchParams.get('offset') || '0');
	const search = url.searchParams.get('q')?.toLowerCase().trim();
	const typeParam = url.searchParams.get('type');
	const attributeParam = url.searchParams.get('attribute');
	const raceParam = url.searchParams.get('race');
	const billboardParam = url.searchParams.get('billboard');
	const idsParam = url.searchParams.get('ids');

	const filePath = join(process.cwd(), 'static/cards/cardinfo.json');
	const raw: { data: unknown } | null = existsSync(filePath)
		? JSON.parse(readFileSync(filePath, 'utf8'))
		: null;

	if (!raw || !raw.data || !Array.isArray(raw.data))
		throw error(503, 'Cards data not found — check static/cards/cardinfo.json');
	const allCards = raw.data as CardItem[];
	let filtered = allCards;

	if (search) {
		filtered = filtered.filter((card) => card.name.toLowerCase().includes(search));
	}
	if (typeParam && typeParam !== 'all') {
		filtered = filtered.filter((card) => card.type === typeParam);
	}
	if (attributeParam && attributeParam !== 'all') {
		filtered = filtered.filter((card) => card.attribute === attributeParam);
	}
	if (raceParam && raceParam !== 'all') {
		filtered = filtered.filter((card) => card.race === raceParam);
	}
	if (billboardParam === 'true') {
		filtered = filtered.filter((card) => Boolean(card.billboard));
	}
	// When `ids` is present, resolve a specific set of cards (e.g. a ygopro deck
	// list) and return them all, bypassing pagination.
	const idSet = idsParam
		? new Set(
				idsParam
					.split(',')
					.map((v) => parseInt(v.trim(), 10))
					.filter((v) => Number.isFinite(v))
			)
		: null;
	if (idSet) {
		filtered = filtered.filter((card) => idSet.has(card.id));
	}
	console.log(filtered)
	console.log({search, typeParam, attributeParam, raceParam})

	const total = filtered.length;
/*
	const paginated = filtered.slice(offset, offset + limit).map((card) => ({
		id: card.id,
		name: card.name,
		type: card.type,
		race: card.race,
		attribute: card.attribute ?? '',
		cardImages: card.cardImages
	}));
*/
	const scoped = idSet ? filtered : filtered.slice(offset, offset + limit);
	const paginated = scoped.map((card: any) => ({
		id: card.id,
		name: card.name,
		type: card.type,
		race: card.race,
		attribute: card.attribute ?? '',
		cardImages: card.card_images,
		billboard: card.billboard,
		atk: card.atk,
		def: card.def,
		lvl: card.level
	}));

	//console.log({allCards})
	return json({
		cards:paginated,
		total,
		availableTypes: [...new Set(allCards.map((c) => c.type).filter(Boolean))].sort(),
		availableAttributes: [
			...new Set(
				allCards.map((c) => c.attribute).filter((v): v is string => Boolean(v) && typeof v === 'string')
			)
		].sort(),
		availableRaces: [...new Set(allCards.map((c) => c.race).filter(Boolean))].sort(),
		source: SOURCE
	});
};
