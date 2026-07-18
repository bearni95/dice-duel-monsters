// Client-side card querying, ported verbatim from the retired
// `/database/cards` server endpoint. The static SPA has no server, so the same
// filtering, faceting and pagination now run in the browser against the
// prebuilt catalog (static/cards/catalog.json, see scripts/build-card-catalog.mjs).
// Keeping this as pure functions means dev and prod share one code path.

/** A card as stored in the prebuilt catalog: the tile field subset plus the
 * precomputed `playable` verdict and `desc` for searching. */
export interface CatalogCard {
	id: number;
	name: string;
	type: string;
	race: string;
	attribute: string;
	cardImages: { image_url_cropped: string }[];
	billboard?: string;
	atk?: number;
	def?: number;
	lvl?: number;
	desc?: string;
	playable: boolean;
}

export interface CardQuery {
	limit?: number;
	offset?: number;
	q?: string;
	type?: string;
	category?: string;
	subType?: string;
	attribute?: string;
	race?: string;
	billboard?: boolean;
	monsterCutout?: boolean;
	playable?: boolean;
	/** Deck's forced card ids — override the playable verdict. */
	force?: number[];
	/** When present, resolve this exact set of cards and bypass pagination. */
	ids?: number[];
}

export interface CardQueryResult {
	cards: CatalogCard[];
	total: number;
	availableTypes: string[];
	availableAttributes: string[];
	availableRaces: string[];
	monsterTypes: string[];
	spellTypes: string[];
	trapTypes: string[];
}

// Normalize text for accent- and case-insensitive matching: lowercase and strip
// diacritics so a plain-ASCII query matches accented card names/effects.
function normalizeText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim();
}

// Classify a card into its top-level category.
function categoryOf(card: CatalogCard): 'monster' | 'spell' | 'trap' | 'other' {
	if (typeof card.type !== 'string') return 'other';
	if (card.type.includes('Monster')) return 'monster';
	if (card.type === 'Spell Card') return 'spell';
	if (card.type === 'Trap Card') return 'trap';
	return 'other';
}

function unique(values: (string | undefined | null)[]): string[] {
	return [...new Set(values.filter((v): v is string => Boolean(v) && typeof v === 'string'))].sort();
}

/**
 * Run a query against the full catalog, reproducing the old endpoint's
 * behaviour exactly: filter, then paginate (unless `ids` is given), and always
 * compute the facet lists over the *unfiltered* catalog.
 */
export function queryCatalog(allCards: CatalogCard[], query: CardQuery): CardQueryResult {
	const search = query.q ? normalizeText(query.q) : '';
	let filtered = allCards;

	if (search) {
		filtered = filtered.filter((card) => {
			const haystack = normalizeText(`${card.name} ${card.desc ?? ''}`);
			return haystack.includes(search);
		});
	}
	if (query.type && query.type !== 'all') {
		filtered = filtered.filter((card) => card.type === query.type);
	}
	if (query.category && query.category !== 'all') {
		filtered = filtered.filter((card) => categoryOf(card) === query.category);
	}
	// Sub-categorization: monsters sub-divide by `type` variety, spells and traps
	// by `race`.
	if (query.subType && query.subType !== 'all') {
		filtered = filtered.filter((card) =>
			categoryOf(card) === 'monster' ? card.type === query.subType : card.race === query.subType
		);
	}
	if (query.attribute && query.attribute !== 'all') {
		filtered = filtered.filter((card) => card.attribute === query.attribute);
	}
	if (query.race && query.race !== 'all') {
		filtered = filtered.filter((card) => card.race === query.race);
	}
	if (query.billboard) {
		filtered = filtered.filter((card) => Boolean(card.billboard));
	}
	// A monster only surfaces once it has a cutout (billboard); non-monster cards
	// always pass through.
	if (query.monsterCutout) {
		filtered = filtered.filter((card) => {
			const isMonster = typeof card.type === 'string' && card.type.includes('Monster');
			return isMonster ? Boolean(card.billboard) : true;
		});
	}
	// Keep only playable cards. The precomputed `playable` flag is authoritative;
	// the optional `force` list overrides it for a deck's forced ids.
	if (query.playable) {
		const forceSet = query.force && query.force.length ? new Set(query.force) : null;
		filtered = filtered.filter((card) => forceSet?.has(card.id) || card.playable);
	}

	const idSet = query.ids && query.ids.length ? new Set(query.ids) : null;
	if (idSet) {
		filtered = filtered.filter((card) => idSet.has(card.id));
	}

	const total = filtered.length;
	const offset = query.offset ?? 0;
	const limit = query.limit ?? 50;
	const scoped = idSet ? filtered : filtered.slice(offset, offset + limit);

	return {
		cards: scoped,
		total,
		availableTypes: unique(allCards.map((c) => c.type)),
		availableAttributes: unique(allCards.map((c) => c.attribute)),
		availableRaces: unique(allCards.map((c) => c.race)),
		monsterTypes: unique(
			allCards.filter((c) => categoryOf(c) === 'monster').map((c) => c.type)
		),
		spellTypes: unique(allCards.filter((c) => categoryOf(c) === 'spell').map((c) => c.race)),
		trapTypes: unique(allCards.filter((c) => categoryOf(c) === 'trap').map((c) => c.race))
	};
}
