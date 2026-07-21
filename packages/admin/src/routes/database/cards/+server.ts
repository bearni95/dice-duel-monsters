import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { existsSync, readFileSync } from 'fs';
import { CARDINFO, CARD_EFFECTS } from '$lib/server/data-paths';

const SOURCE = '/database/cards from data/cards/cardinfo.json';

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
	desc?: string
};

// Normalize text for accent- and case-insensitive matching: lowercase and strip
// diacritics (e.g. "Pothunter" ~ "Pot Hunter", "à" -> "a") so a plain-ASCII query
// matches accented card names/effects.
function normalizeText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim();
}

type CardResponse = {
	cards: Omit<CardItem, 'desc'>[];
	total: number;
	availableTypes: string[];
	availableAttributes: string[];
	availableRaces: string[];
	// Card types split into a top-level category (Monster/Spell/Trap) and the
	// sub-categorization within each. Monsters sub-divide by their `type` variety
	// (Effect, Fusion, XYZ…); spells and traps sub-divide by their `race`
	// (Normal, Quick-Play, Counter…).
	monsterTypes: string[];
	spellTypes: string[];
	trapTypes: string[];
	source: typeof SOURCE;
};

// Classify a raw card into its top-level category.
function categoryOf(card: CardItem): 'monster' | 'spell' | 'trap' | 'other' {
	if (typeof card.type !== 'string') return 'other';
	if (card.type.includes('Monster')) return 'monster';
	if (card.type === 'Spell Card') return 'spell';
	if (card.type === 'Trap Card') return 'trap';
	return 'other';
}

// A vanilla monster (Normal / Normal Tuner / Pendulum Normal) does something on
// its own, so it is playable without any scripted effect. Every other card —
// effect-type monsters, spells, traps — needs an assigned effect to be playable.
function isVanillaMonster(card: CardItem): boolean {
	return (
		categoryOf(card) === 'monster' && typeof card.type === 'string' && card.type.includes('Normal')
	);
}

// A plain Effect Monster — the exact `Effect Monster` type, not its special-summon
// or gimmick variants (Fusion, Synchro, XYZ, Link, Ritual, Pendulum, Flip, Tuner,
// Spirit, Toon, Union, Gemini…). These are treated as playable on their own, like
// vanilla monsters, without needing a scripted effect assigned.
function isPlainEffectMonster(card: CardItem): boolean {
	return card.type === 'Effect Monster';
}

// A Fusion or Ritual monster (any of their `type` variants — "Fusion Monster",
// "Ritual Monster", "Ritual Effect Monster", "Pendulum Effect Fusion Monster",
// "Pendulum Effect Ritual Monster", …). These are now treated as playable on
// their own, like vanilla and plain Effect Monsters, without needing a scripted
// effect assigned.
function isFusionOrRitualMonster(card: CardItem): boolean {
	return (
		categoryOf(card) === 'monster' &&
		typeof card.type === 'string' &&
		(card.type.includes('Fusion') || card.type.includes('Ritual'))
	);
}

// The card-effect assignments (`cardId -> implementations[]`) authored on
// /cards, persisted alongside the card catalog. A card is "playable" when
// it has at least one implementation here (or is a vanilla monster).
function readEffectAssignments(): Record<string, unknown[]> {
	if (!existsSync(CARD_EFFECTS)) return {};
	try {
		const data = JSON.parse(readFileSync(CARD_EFFECTS, 'utf8'));
		return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
	} catch {
		return {};
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const limit = parseInt(url.searchParams.get('limit') || '50');
	const offset = parseInt(url.searchParams.get('offset') || '0');
	const searchRaw = url.searchParams.get('q') ?? '';
	const search = normalizeText(searchRaw);
	const typeParam = url.searchParams.get('type');
	const categoryParam = url.searchParams.get('category');
	const subTypeParam = url.searchParams.get('subType');
	const attributeParam = url.searchParams.get('attribute');
	const raceParam = url.searchParams.get('race');
	const billboardParam = url.searchParams.get('billboard');
	const monsterCutoutParam = url.searchParams.get('monsterCutout');
	const playableParam = url.searchParams.get('playable');
	const forceParam = url.searchParams.get('force');
	const idsParam = url.searchParams.get('ids');

	const raw: { data: unknown } | null = existsSync(CARDINFO)
		? JSON.parse(readFileSync(CARDINFO, 'utf8'))
		: null;

	if (!raw || !raw.data || !Array.isArray(raw.data))
		throw error(503, 'Cards data not found — check data/cards/cardinfo.json');
	const allCards = raw.data as CardItem[];
	let filtered = allCards;

	if (search) {
		// Match the normalized query against the card's name or its effect/description
		// text, so a search finds cards by what they're called or what they do.
		filtered = filtered.filter((card) => {
			const haystack = normalizeText(`${card.name} ${card.desc ?? ''}`);
			return haystack.includes(search);
		});
	}
	if (typeParam && typeParam !== 'all') {
		filtered = filtered.filter((card) => card.type === typeParam);
	}
	// Top-level category (Monster/Spell/Trap) …
	if (categoryParam && categoryParam !== 'all') {
		filtered = filtered.filter((card) => categoryOf(card) === categoryParam);
	}
	// … and its sub-categorization. Monsters sub-divide by `type` variety, while
	// spells and traps sub-divide by `race`.
	if (subTypeParam && subTypeParam !== 'all') {
		filtered = filtered.filter((card) =>
			categoryOf(card) === 'monster' ? card.type === subTypeParam : card.race === subTypeParam
		);
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
	// A monster may only surface once it has a cutout (billboard) prepared for
	// the board; non-monster cards (spells, traps, …) always pass through.
	if (monsterCutoutParam === 'true') {
		filtered = filtered.filter((card) => {
			const isMonster = typeof card.type === 'string' && card.type.includes('Monster');
			return isMonster ? Boolean(card.billboard) : true;
		});
	}
	// Keep only cards that are actually playable: vanilla monsters, plain Effect
	// Monsters, and Fusion/Ritual monsters (all playable on their own), plus any
	// other card (remaining gimmick monster, spell, or trap) that has at least one
	// effect assigned. Used by deck previews so the remaining special-summon
	// monsters and spell/traps without effects are hidden.
	// This is authoritative here rather than in the client. The optional `force`
	// list (a deck's forced card ids) overrides the verdict, so those cards pass
	// even when they wouldn't otherwise be playable.
	if (playableParam === 'true') {
		const effects = readEffectAssignments();
		const forceSet = forceParam
			? new Set(
					forceParam
						.split(',')
						.map((v) => parseInt(v.trim(), 10))
						.filter((v) => Number.isFinite(v))
				)
			: null;
		filtered = filtered.filter((card) => {
			if (forceSet?.has(card.id)) return true;
			if (
				isVanillaMonster(card) ||
				isPlainEffectMonster(card) ||
				isFusionOrRitualMonster(card)
			)
				return true;
			const impls = effects[String(card.id)];
			return Array.isArray(impls) && impls.length > 0;
		});
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
		monsterTypes: [
			...new Set(allCards.filter((c) => categoryOf(c) === 'monster').map((c) => c.type).filter(Boolean))
		].sort(),
		spellTypes: [
			...new Set(allCards.filter((c) => categoryOf(c) === 'spell').map((c) => c.race).filter(Boolean))
		].sort(),
		trapTypes: [
			...new Set(allCards.filter((c) => categoryOf(c) === 'trap').map((c) => c.race).filter(Boolean))
		].sort(),
		source: SOURCE
	});
};
