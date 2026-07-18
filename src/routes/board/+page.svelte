<script lang="ts">
	import { onMount } from 'svelte';
import classNames from 'classnames';
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
	import GameCard from '$components/cards/GameCard.svelte';
	import DiceRoller from '$components/dice/DiceRoller.svelte';

	import type { IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { getDeckById, getPlayerDeck, getCpuDeck } from '$services/deck.service';
	import { enabledCardIds, forcedCardIds } from '$utils/deck/enabledCardIds';
	import rollDie from '$utils/dice/rollDie';

	// The two sides' decks are chosen on the home page and passed here as
	// `?player=<deckId>&cpu=<deckId>` query params. Read them once so each side
	// loads the deck the player picked for this match; when a param is absent the
	// loaders fall back to the last board selection (getPlayerDeck / getCpuDeck).
	function selectedDeckIds(): { player: string | null; cpu: string | null } {
		if (typeof window === 'undefined') return { player: null, cpu: null };
		const params = new URLSearchParams(window.location.search);
		return { player: params.get('player'), cpu: params.get('cpu') };
	}

	let host: HTMLDivElement;

	// The two fixed overlay panels flanking the board. Measured on mount so the
	// grid can be framed into the free gap between them (see frameBoard).
	let leftPanel = $state<HTMLElement | undefined>();
	let rightPanel = $state<HTMLElement | undefined>();

	// The player's draw pile (cards not yet drawn) and current hand. At the start
	// of each player turn the hand is refilled from the top of the deck up to
	// HAND_SIZE; the deck's remaining count is shown in the right column instead of
	// the old full playable-card list.
	let deck = $state<IGameCreature[]>([]);
	let hand = $state<IGameCreature[]>([]);
	let loading = $state(false);

	// The hand is refilled to this size at the start of every turn (both sides).
	const HAND_SIZE = 6;

	// Fisher–Yates shuffle returning a new array, so each match deals its draw pile
	// in a random order rather than the deck's stored order.
	function shuffle<T>(items: T[]): T[] {
		const out = [...items];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	// Refill the player's hand from the top of the deck until it holds HAND_SIZE
	// cards (or the deck runs out). Called at the start of each player turn.
	function drawPlayerHand() {
		while (hand.length < HAND_SIZE && deck.length) {
			const [next, ...rest] = deck;
			deck = rest;
			hand = [...hand, next];
		}
	}

	const cardApiAdapter = new CardApiAdapter();

	let selectedMonster = $state<IGameCreature | null>(null);
	// Creature whose sprite was last clicked on the board; its full card is shown
	// in the top-right corner. Player and rival creatures can both be inspected.
	let inspectedCreature = $state<IGameCreature | null>(null);

	// Which side of the board a unit belongs to. The player commands the red
	// network (origin O1); the CPU rival commands the blue one (origin A15).
	type Side = 'player' | 'cpu';

	// A creature that has been summoned onto the board, with its live sprite and
	// grid position (updated as it moves). Its HP is tracked live and mirrored by
	// a progressbar floating above the sprite.
	interface PlacedUnit {
		unitId: number;
		side: Side;
		creature: IGameCreature;
		sprite: Sprite;
		// Flattened black ellipse painted on the unit's cell as its shadow.
		shadow: Graphics;
		x: number;
		y: number;
		hp: number;
		maxHp: number;
		healthBar: Container;
	}

	// Placed creatures keyed by a unique per-unit instance id (the same card can
	// exist on both sides, so the card id can't be the key).
	const placedUnits = new Map<number, PlacedUnit>();
	let unitSeq = 0;

	// The placed unit last clicked (its card + actions show in the top-right
	// panel). Kept as a plain variable because it holds live Pixi objects that
	// must not be wrapped in a reactive proxy.
	let inspectedUnit: PlacedUnit | null = null;
	// Whether the inspected unit belongs to the player (drives the action
	// buttons; a rival's card shows the same buttons but all disabled).
	let inspectedIsPlayer = $state(false);

	// Move mode: true while the player is choosing a destination tile for the
	// unit shown in the top-right panel. The Move button toggles to Cancel.
	let moving = $state(false);
	// The unit currently being moved, and the painted floor tiles it may move to
	// (highlighted while in move mode; restored on cancel/complete).
	let movingUnit: PlacedUnit | null = null;
	let moveHighlight: string[] = [];

	// Highlight color for reachable destination tiles during move mode.
	const MOVE_TARGET_COLOR = 0x33dd66;

	// Combat mode: true while the player is choosing a target for the attacker
	// shown in the top-right panel. The Combat button toggles to Cancel.
	let combating = $state(false);
	// The attacker (a player unit) and the target tiles it may strike this turn
	// (rival creatures / the rival's origin cell in immediate range). Highlighted
	// while targeting; restored on cancel/resolve.
	let attackingUnit: PlacedUnit | null = null;
	let combatHighlight: string[] = [];
	// Whether the inspected player unit has at least one rival target in immediate
	// range — computed on click to drive the Combat button (inspectedUnit isn't
	// reactive on its own).
	let inspectedCanCombat = $state(false);
	// Highlight color for attackable target tiles during combat targeting.
	const COMBAT_TARGET_COLOR = 0xff3344;
	// Last combat outcome (dice faces + hit tally), shown as a brief toast. Null
	// when there is no recent combat.
	let combatResult = $state<{
		attacker: string;
		target: string;
		// Billboard art for each participant, shown in the left combat panel. The
		// attacker is always a creature (so always has art); the target is a creature
		// or an origin cell (which has none, so its art is undefined).
		attackerArt?: string;
		targetArt?: string;
		rolls: number[];
		threshold: number;
		hits: number;
	} | null>(null);
	let combatResultTimer: ReturnType<typeof setTimeout> | null = null;

	// The player's last combat roll's hit dice (values at/above the target's
	// defense), stamped as white result squares over the black dice in the shared
	// 3D box. Null when there's no recent player combat to mark, or once the box is
	// reused for another roll (energy, HP, the rival's turn).
	let combatBoxHits = $state<number[] | null>(null);

	// Battle outcome. Set the moment one side's origin cell runs out of life
	// points; drives the game-over modal. Null while the match is still in play.
	// Snapshots each origin's remaining hearts so the result reads correctly even
	// as the board keeps its live objects around.
	let gameOver = $state<{
		winner: Side;
		playerLp: number;
		rivalLp: number;
	} | null>(null);

	// Energy points accumulated from dice rolls in the card-container header.
	let energyPoints = $state(0);

	// True while a player summon is playing out: from the moment the tile is
	// clicked through the floor paint, sprite fade-in, HP dice roll and health-bar
	// reveal. The right-side column's buttons (tray Select actions and the inspect
	// panel's Move/Combat/Effect) are disabled for this window so a second card
	// can't be summoned before the current one lands with its rolled HP.
	let summoning = $state(false);

	// Shared turn counter for the summon-cost ramp. Both players share a turn
	// number: the player acts, then the rival acts on the same turn, then the
	// number advances.
	let turnNumber = $state(1);

	// Bound instance of the top-left DiceRoller panel, used to roll a summoned
	// creature's HP dice and the rival's energy dice in the shared 3D dice box.
	let diceRoller:
		| { rollPool: (count: number, themeColor?: string) => Promise<number[]> }
		| undefined;

	// Theme color for the rival's dice in the shared 3D box (blue, matching its
	// blue network), so its rolls read differently from the player's green ones.
	const RIVAL_DICE_COLOR = '#4d8cff';

	// Theme color for a summoned creature's HP dice in the shared 3D box (red), so
	// an HP roll reads differently from the player's green energy rolls.
	const HP_DICE_COLOR = '#ff3344';

	// Theme color for the player's combat dice in the shared 3D box: black, so an
	// attack roll reads distinctly from green energy and red HP rolls. The dice that
	// land as hits are then marked with white result squares over the box.
	const COMBAT_DICE_COLOR = '#0f0f0f';

	// The CPU rival's deck (loaded from the selected CPU deck), the card ids it
	// has already summoned, its energy for the current rival turn, and a flag
	// that's true while the rival is taking its turn (blocks player input).
	let cpuDeck: IGameCreature[] = [];
	let cpuHand: IGameCreature[] = [];

	// Refill the rival's hand from the top of its deck to HAND_SIZE at the start of
	// each rival turn (the mirror of the player's drawPlayerHand).
	function drawCpuHand() {
		while (cpuHand.length < HAND_SIZE && cpuDeck.length) {
			const [next, ...rest] = cpuDeck;
			cpuDeck = rest;
			cpuHand = [...cpuHand, next];
		}
	}
	// Reactive so the rival's remaining energy can be mirrored in the DiceRoller
	// panel and update live as the CPU spends it during its turn.
	let cpuEnergy = $state(0);
	let rivalThinking = $state(false);
	// The rival's last 3d6 energy roll, mirrored in the DiceRoller panel so the
	// player can see what the CPU rolled. Null faces until its first turn.
	let rivalFaces = $state<(number | null)[]>([null, null, null]);

	const cpuAdapter = new CardApiAdapter();

	// A card can be summoned when its cost fits the current energy pool.
	function canSummon(card: IGameCreature): boolean {
		return card.cost <= energyPoints;
	}

	// Hand order: summonable (affordable) cards first, then by cost ascending.
	let sortedHand = $derived(
		[...hand].sort((a, b) => {
			const aSummon = canSummon(a);
			const bSummon = canSummon(b);

			if (aSummon !== bSummon) return aSummon ? -1 : 1;

			return a.cost - b.cost;
		})
	);

	// The creature attributes the tray can be sorted by, and their column labels.
	const sortColumns = [
		{ key: 'cost', label: 'Cost' },
		{ key: 'atk', label: 'Atk' },
		{ key: 'def', label: 'Def' },
		{ key: 'hp', label: 'HP' },
		{ key: 'speed', label: 'SPD' }
	] as const;

	type SortKey = (typeof sortColumns)[number]['key'];

	// Active tray sort: the attribute to sort by and the direction. Null key means
	// no manual sort is applied (the default summonable-first ordering is used).
	let sortKey = $state<SortKey | null>(null);
	let sortDir = $state<'asc' | 'desc'>('asc');

	// Cycle the sort when a column header is clicked: a new column starts ascending;
	// the active column goes asc → desc → off; then the cycle restarts.
	function toggleSort(key: SortKey) {
		if (sortKey !== key) {
			sortKey = key;
			sortDir = 'asc';
		} else if (sortDir === 'asc') {
			sortDir = 'desc';
		} else {
			sortKey = null;
			sortDir = 'asc';
		}
	}

	// The whole hand is shown in the tray (up to HAND_SIZE cards) — cards the player
	// can't afford yet are shown too, with their Select button disabled, rather than
	// hidden. When a column sort is active it overrides the default ordering.
	let handCards = $derived.by(() => {
		const key = sortKey;
		if (!key) return sortedHand;

		const dir = sortDir === 'asc' ? 1 : -1;
		return [...sortedHand].sort(
			(a, b) => ((a[key] as number) - (b[key] as number)) * dir
		);
	});

	// Load a hand card into the top-right detail panel — the same panel a clicked
	// board creature fills. A hand card isn't a placed unit, so it's inspect-only:
	// the unit-bound actions (Move/Combat/Effect) show disabled. Ignored while a
	// move/combat is in progress so the panel stays locked to the acting unit,
	// mirroring the on-board sprite handler.
	function inspectCard(card: IGameCreature) {
		if (moving || combating) return;
		inspectedUnit = null;
		inspectedCreature = card;
		inspectedIsPlayer = false;
		inspectedCanCombat = false;
	}

	async function loadCards(
		p: number,
		q = '',
		type = 'all',
		attr = 'all',
		race = 'all'
	) {
		loading = true;

		try {
			// Only pull monsters that have a billboard image, so all 5 are placeable.
			await cardApiAdapter.load(p, q, type, attr, race, true);

			deck = shuffle(cardApiAdapter.cards.splice(0, 5));
			drawPlayerHand();
		} catch (e) {
			console.error('Failed to load cards:', e);
		} finally {
			loading = false;
		}
	}

	// Use the deck chosen for the player on the home page (via the `?player=`
	// query param) as the hand, falling back to the last board selection. Falls
	// back to a random monster pull when no deck has been chosen yet.
	async function loadDeck() {
		const { player } = selectedDeckIds();
		const chosen = (await getDeckById(player)) ?? (await getPlayerDeck());

		if (!chosen?.main.length) {
			await loadCards(1);
			return;
		}

		loading = true;

		try {
			// Only playable, enabled cards make it into the deck: drop the ids the
			// owner turned off in the deck editor, then resolve them playable-only —
			// passing the deck's forced ids so cards toggled on despite being flagged
			// not playable are kept too.
			await cardApiAdapter.loadByIds(enabledCardIds(chosen, chosen.main), true, forcedCardIds(chosen));
			// Shuffle the playable (billboard) cards into the draw pile, then deal the
			// opening hand up to HAND_SIZE.
			deck = shuffle(cardApiAdapter.cards.filter((c) => c.billboard));
			drawPlayerHand();
		} catch (e) {
			console.error('Failed to load deck:', e);
		} finally {
			loading = false;
		}
	}

	// Load the deck chosen for the CPU rival on the home page (via the `?cpu=`
	// query param), falling back to the last board selection, so it has creatures
	// to summon on its turns. Only placeable (billboard) monsters are kept.
	async function loadCpuDeck() {
		const { cpu } = selectedDeckIds();
		const chosen = (await getDeckById(cpu)) ?? (await getCpuDeck());
		if (!chosen?.main.length) return;

		try {
			// Same filter as the player's deck: enabled ids only, resolved playable-only,
			// with the deck's forced ids kept past the playable verdict. The rival draws
			// its opening hand at the start of its first turn (see runCpuTurn).
			await cpuAdapter.loadByIds(enabledCardIds(chosen, chosen.main), true, forcedCardIds(chosen));
			cpuDeck = shuffle(cpuAdapter.cards.filter((c) => c.billboard));
		} catch (e) {
			console.error('Failed to load CPU deck:', e);
		}
	}

		const app = new Application();

		const TILE_WIDTH = 64;
		const TILE_HEIGHT = 32;
		const GRID_WIDTH = 10;
		const GRID_HEIGHT = 10;

		const MIN_ZOOM = 0.25;
		const MAX_ZOOM = 4;

		let camera: Container;
let grid: Container;
let labels: Container;
// Sits below `units` so each creature's shadow ellipse renders on its cell,
// under the sprites.
let shadows: Container;
let units: Container;
// Sits above `units` so HP bars and origin LP counters always render on top of
// the creature sprites.
let overlays: Container;

// Frame the whole isometric grid into the horizontal gap the two fixed side
// panels leave free, centered in that gap (and vertically in the canvas). Called
// once the board is built so the match opens looking at the play area rather than
// the top-center default. The grid's diamonds span GRID*TILE on each axis and its
// isoX is symmetric about 0, so its world center sits at x=0, y=((H-1)*TILE)/2.
function frameBoard() {
	const worldWidth = GRID_WIDTH * TILE_WIDTH;
	const worldHeight = GRID_HEIGHT * TILE_HEIGHT;
	const worldCenterY = ((GRID_HEIGHT - 1) * TILE_HEIGHT) / 2;

	// Width the panels leave free (their offsetWidth includes padding). Falls back
	// to the full canvas before they've measured.
	const leftW = leftPanel?.offsetWidth ?? 0;
	const rightW = rightPanel?.offsetWidth ?? 0;
	const availableW = Math.max(1, app.screen.width - leftW - rightW);

	// Fit the grid into the free gap by width, but never let it spill past the top
	// or bottom of the canvas — take whichever axis is the tighter constraint.
	// A small margin keeps the edge tiles off the panels.
	const MARGIN = 0.92;
	const scale = Math.max(
		MIN_ZOOM,
		Math.min(
			MAX_ZOOM,
			(availableW / worldWidth) * MARGIN,
			(app.screen.height / worldHeight) * MARGIN
		)
	);
	camera.scale.set(scale);

	// Place the grid's world center at the center of the free gap horizontally and
	// at the canvas midline vertically (worldCenterX is 0, so it drops out of x).
	camera.x = leftW + availableW / 2;
	camera.y = app.screen.height / 2 - worldCenterY * scale;
}

// Turn a 0-based column index into a spreadsheet-style letter (A..Z, AA..).
function columnLabel(index: number): string {
	let label = '';
	let n = index;

	do {
		label = String.fromCharCode(65 + (n % 26)) + label;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);

	return label;
}

const tiles = new Map<string, Graphics>();

// Cell colors the engine can paint permanently.
const CELL_RED = 0xff0000;
const CELL_BLUE = 0x4d8cff;

// Occupied cells and their painted color: tile key -> tint color.
// Placed monsters and O1 are red; O15 is blue.
const occupied = new Map<string, number>();

// Paint a cell its recorded color and remember it as occupied.
function paintCell(x: number, y: number, color: number) {
	const key = tileKey(x, y);
	occupied.set(key, color);

	const tile = tiles.get(key);
	if (!tile) return;

	tile.tint = color;
	tile.alpha = 1;
}

// Life points the two origin cells (red = O1, blue = A15) start with.
const ORIGIN_LP = 3;

// A destroyable origin cell: its grid position, network side/color, remaining
// life points and the vertical heart stack drawn over it as its LP counter
// (one heart per point, rebuilt as it takes hits).
interface OriginCell {
	x: number;
	y: number;
	side: Side;
	color: number;
	lp: number;
	hearts: Container;
}

// The two origin cells, populated once the board is built in onMount.
let redOrigin: OriginCell | null = null;
let blueOrigin: OriginCell | null = null;

// The origin cell an attacker on the given side is trying to destroy (its
// rival's origin).
function rivalOriginFor(side: Side): OriginCell | null {
	return side === 'player' ? blueOrigin : redOrigin;
}

// Whether a grid cell is one of the two origin cells. Origins are network roots,
// not walkable ground: a creature may never move onto (or through) one, though
// it is a legal combat target (see combatTargetsFor / moveTargetsFor).
function isOriginCell(x: number, y: number): boolean {
	return (
		(!!redOrigin && redOrigin.x === x && redOrigin.y === y) ||
		(!!blueOrigin && blueOrigin.x === x && blueOrigin.y === y)
	);
}

// The isometric screen position of a grid cell's center.
function isoPosOf(x: number, y: number) {
	return {
		x: (x - y) * (TILE_WIDTH / 2),
		y: (x + y) * (TILE_HEIGHT / 2)
	};
}

// Depth key for a unit's sprite within the sortable `units` container: its
// screen-space isoY, so a creature lower on the board (larger x + y) gets a
// higher zIndex and renders in front of creatures farther up the grid.
function depthFor(x: number, y: number): number {
	return (x + y) * (TILE_HEIGHT / 2);
}

// The hearts icon shared with the card renderer (GameCard uses it for HP),
// loaded once in init and stacked over each origin cell as its LP counter.
let heartTexture: Texture | null = null;

// In the 512px hearts viewBox the bottom tip sits at y≈480.785 and the top of
// the lobes at y≈31, so the drawn heart is ~0.878 of the box tall.
const HEART_TIP_Y = 480.785 / 512;
const HEART_VISIBLE_H = (480.785 - 31) / 512;
// Vertical gap left between two stacked hearts, in world px.
const HEART_STACK_GAP = 2;

// One heart sized to the tile, anchored at its bottom tip so the tip lands on
// wherever the sprite is positioned.
function heartSprite(): Sprite {
	const icon = new Sprite(heartTexture!);
	icon.anchor.set(0.5, HEART_TIP_Y);
	icon.scale.set(TILE_HEIGHT / heartTexture!.height);
	return icon;
}

// (Re)fill a container with one heart per life point, stacked vertically: the
// bottom heart's tip sits at the container origin and each further heart rises
// above it.
function fillHearts(container: Container, lp: number) {
	for (const child of container.removeChildren()) child.destroy();

	const step = TILE_HEIGHT * HEART_VISIBLE_H + HEART_STACK_GAP;

	for (let i = 0; i < lp; i++) {
		const heart = heartSprite();
		heart.position.set(0, -i * step);
		container.addChild(heart);
	}
}

// Build an origin cell's LP counter as a vertical stack of hearts (one per life
// point) centered on the cell, returning the container so combat can rebuild it
// as the origin loses life.
function drawOriginHearts(x: number, y: number, lp: number): Container {
	if (!heartTexture) return new Container();

	const { x: isoX, y: isoY } = isoPosOf(x, y);

	const container = new Container();
	container.position.set(isoX, isoY);
	overlays.addChild(container);

	fillHearts(container, lp);

	return container;
}

// HP progressbar dimensions (in board/world units, before camera zoom).
const HP_BAR_WIDTH = 44;
const HP_BAR_HEIGHT = 6;

// Bar fill color: green while healthy, amber past half, red when low.
function hpColor(ratio: number): number {
	if (ratio > 0.5) return 0x33dd66;
	if (ratio > 0.25) return 0xffcc33;
	return 0xff4444;
}

// Build a floating HP progressbar (background track + colored fill + label).
// The fill Graphics is tagged so redrawHealthBar can find and rescale it.
function createHealthBar(hp: number, maxHp: number): Container {
	const bar = new Container();

	const bg = new Graphics()
		.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT)
		.fill({ color: 0x000000, alpha: 0.65 })
		.stroke({ width: 1, color: 0x000000, alpha: 0.9 });
	bar.addChild(bg);

	const fill = new Graphics();
	fill.label = 'fill';
	bar.addChild(fill);

	// The bar lives inside the zoomable `camera` container, so a Text baked at the
	// default resolution 1 turns blurry once the board is zoomed in. Rasterize it at
	// the max zoom (times the device pixel ratio) so it stays crisp all the way in.
	const label = new Text({
		text: '',
		style: { fill: 0xffffff, fontSize: 10, fontWeight: '700' },
		resolution: MAX_ZOOM * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
	});
	label.label = 'label';
	label.anchor.set(0.5, 1);
	label.position.set(0, -1);
	bar.addChild(label);

	overlays.addChild(bar);

	redrawHealthBar(bar, hp, maxHp);

	return bar;
}

// Repaint an HP bar's fill width/color and label for the current HP value.
function redrawHealthBar(bar: Container, hp: number, maxHp: number) {
	const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

	const fill = bar.getChildByLabel('fill') as Graphics | null;
	if (fill) {
		fill
			.clear()
			.rect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH * ratio, HP_BAR_HEIGHT)
			.fill(hpColor(ratio));
	}

	const label = bar.getChildByLabel('label') as Text | null;
	if (label) label.text = `${hp}/${maxHp}`;
}

// Shadow ellipse radii. Kept at the cell's 2:1 isometric proportions (from
// TILE_WIDTH:TILE_HEIGHT) and shrunk to half the cell's half-extents so the
// footprint sits well inside the diamond rather than spilling over its edges.
const SHADOW_RADIUS_X = (TILE_WIDTH / 2) * 0.5;
const SHADOW_RADIUS_Y = (TILE_HEIGHT / 2) * 0.5;

// Build a 50%-black isometric shadow ellipse for a unit, sitting on its cell.
function createShadow(x: number, y: number): Graphics {
	const shadow = new Graphics()
		.ellipse(0, 0, SHADOW_RADIUS_X, SHADOW_RADIUS_Y)
		.fill({ color: 0x000000, alpha: 0.5 });

	const { x: isoX, y: isoY } = isoPosOf(x, y);
	shadow.position.set(isoX, isoY);

	shadows.addChild(shadow);

	return shadow;
}

// Keep a unit's shadow centered on the cell it currently stands on.
function positionShadow(unit: PlacedUnit) {
	const { x: isoX, y: isoY } = isoPosOf(unit.x, unit.y);
	unit.shadow.position.set(isoX, isoY);
}

// Float a unit's HP bar just above the top of its sprite at its current tile.
function positionHealthBar(unit: PlacedUnit) {
	const { x: isoX, y: isoY } = isoPosOf(unit.x, unit.y);
	unit.healthBar.position.set(
		isoX,
		isoY - unit.sprite.height * unit.sprite.anchor.y - 10
	);
}

// Hover-preview state: ghost billboard + the T-shape floor at 50% opacity.
let previewSprite: Sprite | null = null;
let previewTiles: string[] = [];
// Bumped on every show/clear so a slow async texture load can't revive
// a preview the pointer has already left.
let previewToken = 0;

function tileKey(x: number, y: number) {
	return `${x},${y}`;
}

// Offsets of an unfolded 6-sided dice net (a "T"/cross shape),
// relative to the crossroads tile where the card is played.
// The long arm points north-west on the isometric board (-x).
const DICE_NET_OFFSETS: Array<[number, number]> = [
	[0, 0], // crossroads (played tile)
	[0, -1], // north-east arm
	[1, 0], // south-east arm
	[0, 1], // south-west arm
	[-1, 0], // north-west arm (short)
	[-2, 0] // north-west arm (long)
];

// Orthogonal grid neighbors — the cells that share an edge with a tile on the
// isometric board (used to test whether a net tile "touches" another cell).
const NEIGHBOR_OFFSETS: Array<[number, number]> = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1]
];

// Current orientation of the dice net, in 90° clockwise steps (0..3). Rotated
// with the mouse wheel while a creature is selected for summoning.
let netRotation = 0;
// Last grid cell the pointer hovered, so a wheel-rotation can re-render the
// preview in place.
let hoverTile: { x: number; y: number } | null = null;

// Unfold mode: true while the player is choosing a tile to unfold a plain dice
// net — extending the red network floor without summoning a creature. Triggered
// from the left panel's "Unfold" button and using the same net preview and
// wheel rotation as summoning. Costs a fixed amount of energy.
let unfolding = $state(false);

// The fixed energy cost of a standalone Unfold action.
const UNFOLD_COST = 6;

// The dice-net offsets rotated by `rot`90° clockwise steps. A single step maps
// (dx, dy) -> (-dy, dx).
function offsetsForRotation(rot: number): Array<[number, number]> {
	let offsets = DICE_NET_OFFSETS;

	for (let i = 0; i < rot; i++) {
		offsets = offsets.map(([dx, dy]) => [-dy, dx] as [number, number]);
	}

	return offsets;
}

// The dice-net offsets rotated by the current player orientation.
function rotatedOffsets(): Array<[number, number]> {
	return offsetsForRotation(netRotation);
}

// Whether the cell is painted the given network color.
function isColor(x: number, y: number, color: number): boolean {
	return occupied.get(tileKey(x, y)) === color;
}

// A creature may only be summoned where its unfolded dice net (given as
// `offsets`) would extend the network of `color`: at least one net tile must be
// an empty cell that is edge-adjacent to a cell already painted `color`. Cells
// of the other side's color don't count.
function canPlaceForColor(
	gridX: number,
	gridY: number,
	color: number,
	offsets: Array<[number, number]>
): boolean {
	// The creature stands on the crossroads (played) cell, so it must be one
	// fully empty tile — no ground and no occupant. A unit can never be summoned
	// onto existing floor, nor onto a cell another creature already stands on.
	if (occupied.has(tileKey(gridX, gridY))) return false;
	if (unitAt(gridX, gridY)) return false;

	for (const [dx, dy] of offsets) {
		const x = gridX + dx;
		const y = gridY + dy;

		// Only empty net tiles can extend the network.
		if (occupied.has(tileKey(x, y))) continue;

		// ...and the extending tile must touch an existing same-color tile.
		for (const [nx, ny] of NEIGHBOR_OFFSETS) {
			if (isColor(x + nx, y + ny, color)) return true;
		}
	}

	return false;
}

// The player's placement test: extend the red network at the current net
// orientation.
function canPlaceAt(gridX: number, gridY: number): boolean {
	return canPlaceForColor(gridX, gridY, CELL_RED, rotatedOffsets());
}

// Tween a display object's alpha from 0 up to 1 over `ms`, driven by the app
// ticker. Resolves once the fade finishes so summon steps can be sequenced.
function fadeIn(target: Container, ms = 220): Promise<void> {
	target.alpha = 0;

	return new Promise((resolve) => {
		let elapsed = 0;

		const tick = (ticker: Ticker) => {
			elapsed += ticker.deltaMS;
			target.alpha = Math.min(1, elapsed / ms);

			if (elapsed >= ms) {
				app.ticker.remove(tick);
				resolve();
			}
		};

		app.ticker.add(tick);
	});
}

// Summon a creature onto the board for the given side. `color` is the network
// color painted under it (red for the player, blue for the CPU) and `offsets`
// is the dice-net shape (already rotated) stamped as its floor.
//
// The summon plays out in stages: the floor path colors in the moment the tile
// is clicked, the creature then fades in over the painted floor, and finally its
// HP (rolled on the dice) fades in together with its health bar.
async function placeMonster(
	creature: IGameCreature,
	gridX: number,
	gridY: number,
	side: Side,
	color: number,
	offsets: Array<[number, number]>
) {
	const texture = await Assets.load(creature.billboard!);

	// Stage 1 — paint the floor immediately, so the "T" path colors in the moment
	// the tile is clicked. The played tile is the crossroads of the cross; every
	// painted tile is recorded as occupied in this side's network color. Net
	// squares that unfold onto a cell that already has ground are skipped — the
	// net only ever lays new floor, never repaints (or overwrites) existing floor.
	for (const [dx, dy] of offsets) {
		const x = gridX + dx;
		const y = gridY + dy;
		if (occupied.has(tileKey(x, y))) continue;
		paintCell(x, y, color);
	}

	// Isometric shadow ellipse on the creature's cell, under its sprite.
	const shadow = createShadow(gridX, gridY);

	const sprite = new Sprite(texture);

	// As wide as the isometric cell, with the billboard's bottom edge anchored to
	// the cell center (anchor.y = 1), so the image's vertical end sits on the tile.
	const scale = TILE_WIDTH / texture.width;
	sprite.scale.set(scale);
	sprite.anchor.set(0.5, 1);

	const isoX = (gridX - gridY) * (TILE_WIDTH / 2);
	const isoY = (gridX + gridY) * (TILE_HEIGHT / 2);

	sprite.position.set(isoX, isoY);
	// Row-based depth so lower creatures overlap higher ones (see depthFor).
	sprite.zIndex = depthFor(gridX, gridY);

	sprite.eventMode = 'static';
	sprite.cursor = 'pointer';

	units.addChild(sprite);

	// Stage 2 — fade the creature in now that its floor is painted.
	await fadeIn(sprite);

	// Stage 3 — roll the creature's HP dice pool to fix its starting (and max) HP
	// for this board instance. The player's own summons roll their HP dice in the
	// shared 3D dice box so the roll is visible; the rival's summons roll silently
	// (it fires many summons in quick succession during its turn).
	let rolledHp = 0;
	if (side === 'player' && diceRoller) {
		// The HP roll takes over the shared box; drop any lingering combat marks.
		combatBoxHits = null;
		const faces = await diceRoller.rollPool(creature.hp, HP_DICE_COLOR);
		rolledHp = faces.reduce((sum, face) => sum + face, 0);
	} else {
		for (let i = 0; i < creature.hp; i++) rolledHp += rollDie(6);
	}

	// Track the placed unit so it can later be moved around the board.
	const unit: PlacedUnit = {
		unitId: ++unitSeq,
		side,
		creature,
		sprite,
		shadow,
		x: gridX,
		y: gridY,
		hp: rolledHp,
		maxHp: rolledHp,
		healthBar: null as unknown as Container
	};

	// Clicking a placed creature reveals its full card in the top-right corner.
	// The panel sticks: once shown it keeps the last clicked creature until
	// another on-board creature is clicked. Both player and rival creatures can
	// be inspected (a rival's card shows the same buttons, all disabled). While a
	// move/combat is in progress clicks are ignored so the panel keeps showing the
	// unit being acted on.
	sprite.on('pointertap', () => {
		if (moving || combating) return;
		inspectedUnit = unit;
		inspectedCreature = creature;
		inspectedIsPlayer = unit.side === 'player';
		// Precompute whether this unit has a rival target in range so the Combat
		// button can reflect it (inspectedUnit isn't reactive on its own).
		inspectedCanCombat = unit.side === 'player' && combatTargetsFor(unit).length > 0;
	});

	placedUnits.set(unit.unitId, unit);

	// Stage 4 — the HP bar (with its rolled HP) fades in now the roll is done.
	unit.healthBar = createHealthBar(rolledHp, rolledHp);
	positionHealthBar(unit);
	await fadeIn(unit.healthBar);

	// Hand back the placed unit so the caller can re-point the inspect panel at it
	// (e.g. a player summon inspecting the freshly landed creature once its HP roll
	// has resolved).
	return unit;
}

// Painted floor tiles a unit can reach: destinations reachable by walking a
// path of painted floor tiles (orthogonal steps) no longer than the unit's
// speed. A route may only cross painted cells that no other creature stands on —
// an empty cell or a cell held by another creature blocks that route entirely,
// so a target within speed range is unreachable unless a clear painted path
// connects to it. Computed with a breadth-first flood so each reachable cell is
// found at its shortest step count.
function moveTargetsFor(unit: PlacedUnit): string[] {
	const speed = unit.creature.speed;
	const startKey = tileKey(unit.x, unit.y);

	// Fewest steps found to each reachable cell (0 for the unit's own tile).
	const distances = new Map<string, number>([[startKey, 0]]);

	const queue: Array<{ x: number; y: number; dist: number }> = [
		{ x: unit.x, y: unit.y, dist: 0 }
	];

	while (queue.length) {
		const { x, y, dist } = queue.shift()!;
		if (dist >= speed) continue;

		for (const [nx, ny] of NEIGHBOR_OFFSETS) {
			const cx = x + nx;
			const cy = y + ny;
			const key = tileKey(cx, cy);

			// Already reached by an equal or shorter path.
			if (distances.has(key)) continue;

			// A route can only cross painted floor — an empty cell breaks the path.
			if (!occupied.has(key)) continue;

			// ...and never a cell another creature occupies (it can't be walked
			// through, and can't be landed on).
			const occupant = unitAt(cx, cy);
			if (occupant && occupant !== unit) continue;

			// ...and never an origin cell — a network root can't be moved onto or
			// walked through (it's a combat target only).
			if (isOriginCell(cx, cy)) continue;

			distances.set(key, dist + 1);
			queue.push({ x: cx, y: cy, dist: dist + 1 });
		}
	}

	// The unit's own tile isn't a move destination.
	distances.delete(startKey);

	return [...distances.keys()];
}

// Disable pointer handling on every on-board creature sprite so clicks fall
// through to the tiles beneath them. Used while the player is picking a move
// destination or combat target — a creature's sprite otherwise sits above a
// cell and swallows the tap, making highlighted cells unclickable.
function disableUnitInteractivity() {
	for (const unit of placedUnits.values()) {
		unit.sprite.eventMode = 'none';
	}
}

// Restore pointer handling on every on-board creature sprite once the move or
// combat action ends.
function restoreUnitInteractivity() {
	for (const unit of placedUnits.values()) {
		unit.sprite.eventMode = 'static';
	}
}

// Enter move mode for the inspected unit: highlight every reachable painted tile
// and lock the panel to this unit until the move completes or is canceled.
function startMove() {
	const unit = inspectedUnit;
	// Only the player's own units can be moved by hand.
	if (!unit || unit.side !== 'player') return;

	// No more actions once the match is decided.
	if (gameOver) return;

	// Not enough energy to pay the creature's cost: can't move.
	if (energyPoints < unit.creature.cost) return;

	movingUnit = unit;
	moveHighlight = moveTargetsFor(unit);

	for (const key of moveHighlight) {
		const tile = tiles.get(key);
		if (!tile) continue;

		tile.tint = MOVE_TARGET_COLOR;
		tile.alpha = 0.7;
	}

	// Let clicks fall through the creature sprites so the highlighted destination
	// cells beneath them are actually clickable.
	disableUnitInteractivity();

	moving = true;
}

// Repaint the highlighted destination tiles back to their real state.
function restoreMoveHighlight() {
	for (const key of moveHighlight) {
		const tile = tiles.get(key);
		if (!tile) continue;

		const color = occupied.get(key);
		if (color !== undefined) {
			tile.tint = color;
			tile.alpha = 1;
		} else {
			tile.tint = 0xffffff;
			tile.alpha = 0;
		}
	}

	moveHighlight = [];
}

// Leave move mode without moving.
function cancelMove() {
	restoreMoveHighlight();
	restoreUnitInteractivity();
	moving = false;
	movingUnit = null;
}

// Relocate a unit's sprite (and HP bar) to a new grid cell.
function relocateUnit(unit: PlacedUnit, x: number, y: number) {
	const isoX = (x - y) * (TILE_WIDTH / 2);
	const isoY = (x + y) * (TILE_HEIGHT / 2);
	unit.sprite.position.set(isoX, isoY);
	// Refresh row-based depth so the unit re-sorts against others at its new tile.
	unit.sprite.zIndex = depthFor(x, y);

	unit.x = x;
	unit.y = y;

	// Keep the shadow and HP bar aligned with the sprite's new tile.
	positionShadow(unit);
	positionHealthBar(unit);
}

// Finish the player's move: relocate the sprite, update the unit's grid position
// and charge the creature's cost to the energy pool.
function completeMove(x: number, y: number) {
	const unit = movingUnit;
	if (!unit) return;

	restoreMoveHighlight();
	restoreUnitInteractivity();

	relocateUnit(unit, x, y);

	energyPoints -= unit.creature.cost;

	// The unit shown in the top-right panel just changed cells, so its combat
	// reach was recomputed against the new position — refresh the Combat button's
	// enablement now instead of waiting for the player to re-click the creature.
	if (inspectedUnit === unit) {
		inspectedCanCombat = unit.side === 'player' && combatTargetsFor(unit).length > 0;
	}

	moving = false;
	movingUnit = null;
}

// --- Combat ---

// The placed unit standing on a grid cell, if any.
function unitAt(x: number, y: number): PlacedUnit | null {
	for (const unit of placedUnits.values()) {
		if (unit.x === x && unit.y === y) return unit;
	}

	return null;
}

// The tiles an attacker can strike this turn: any cell within the creature's
// reach (measured in grid steps / Manhattan distance) that holds a rival
// creature, plus the rival's origin cell when it's within reach and still alive.
// Reach is derived from the creature's level (ceil(level / 4)); the lowest reach
// of 1 keeps the old edge-adjacent behavior as the minimum.
function combatTargetsFor(unit: PlacedUnit): string[] {
	const targets: string[] = [];
	const reach = unit.creature.reach;
	const rivalOrigin = rivalOriginFor(unit.side);

	// Rival creatures within reach.
	for (const other of placedUnits.values()) {
		if (other.side === unit.side) continue;

		const distance = Math.abs(other.x - unit.x) + Math.abs(other.y - unit.y);
		if (distance <= reach) targets.push(tileKey(other.x, other.y));
	}

	// The rival's origin cell, when still alive and within reach.
	if (rivalOrigin && rivalOrigin.lp > 0) {
		const distance =
			Math.abs(rivalOrigin.x - unit.x) + Math.abs(rivalOrigin.y - unit.y);
		if (distance <= reach) targets.push(tileKey(rivalOrigin.x, rivalOrigin.y));
	}

	return targets;
}

// Enter combat mode for the inspected unit: highlight every rival target in range
// and lock the panel to this attacker until combat resolves or is canceled.
function startCombat() {
	const unit = inspectedUnit;
	// Only the player's own units can attack by hand.
	if (!unit || unit.side !== 'player') return;

	// No more actions once the match is decided.
	if (gameOver) return;

	// Not enough energy to pay the creature's cost: can't attack.
	if (energyPoints < unit.creature.cost) return;

	const targets = combatTargetsFor(unit);
	if (!targets.length) return;

	attackingUnit = unit;
	combatHighlight = targets;

	for (const key of combatHighlight) {
		const tile = tiles.get(key);
		if (!tile) continue;

		tile.tint = COMBAT_TARGET_COLOR;
		tile.alpha = 0.7;
	}

	enterCombatFocus();

	combating = true;
}

// While choosing a combat target, halve the opacity of every creature that
// isn't the attacker or a valid target, and let clicks fall through the sprites
// to the tiles beneath so any highlighted target cell can actually be picked
// (a sprite otherwise sits above its tile and swallows the tap).
function enterCombatFocus() {
	const targetKeys = new Set(combatHighlight);

	for (const unit of placedUnits.values()) {
		const focused = unit === attackingUnit || targetKeys.has(tileKey(unit.x, unit.y));
		unit.sprite.alpha = focused ? 1 : 0.5;
	}

	// Drop all sprite click handlers so taps fall through to the target cells.
	disableUnitInteractivity();
}

// Restore creature opacity and interactivity once combat targeting ends.
function exitCombatFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 1;
	}

	restoreUnitInteractivity();
}

// Repaint the highlighted target tiles back to their real state.
function restoreCombatHighlight() {
	for (const key of combatHighlight) {
		const tile = tiles.get(key);
		if (!tile) continue;

		const color = occupied.get(key);
		if (color !== undefined) {
			tile.tint = color;
			tile.alpha = 1;
		} else {
			tile.tint = 0xffffff;
			tile.alpha = 0;
		}
	}

	combatHighlight = [];
}

// Leave combat mode without attacking.
function cancelCombat() {
	restoreCombatHighlight();
	exitCombatFocus();
	combating = false;
	attackingUnit = null;
}

// Rebuild an origin cell's heart stack to match its current life points.
function updateOriginLP(origin: OriginCell) {
	fillHearts(origin.hearts, origin.lp);
}

// End the match the moment an origin runs out of life. The side whose rival's
// origin fell is the winner. A snapshot of both origins' remaining hearts is
// stored so the game-over modal can report the final tally. No-op once the game
// is already over, so a later hit can't overwrite the first result.
function checkGameOver() {
	if (gameOver) return;

	const playerLp = redOrigin?.lp ?? 0;
	const rivalLp = blueOrigin?.lp ?? 0;

	if (rivalLp <= 0) gameOver = { winner: 'player', playerLp, rivalLp };
	else if (playerLp <= 0) gameOver = { winner: 'cpu', playerLp, rivalLp };
}

// Subtract `hits` HP from a creature, refresh its progressbar, and take it off
// the board once it runs out of health.
function applyDamageToUnit(unit: PlacedUnit, hits: number) {
	if (hits <= 0) return;

	unit.hp = Math.max(0, unit.hp - hits);
	redrawHealthBar(unit.healthBar, unit.hp, unit.maxHp);

	if (unit.hp <= 0) removeUnit(unit);
}

// Remove a destroyed creature: drop its sprite, HP bar and bookkeeping, and
// clear the top-right panel if it was showing this unit.
function removeUnit(unit: PlacedUnit) {
	unit.sprite.destroy();
	unit.shadow.destroy();
	unit.healthBar.destroy();
	placedUnits.delete(unit.unitId);

	// A destroyed creature's card is spent — it's already left its owner's hand
	// when summoned and doesn't return to the deck.

	if (inspectedUnit === unit) {
		inspectedUnit = null;
		inspectedCreature = null;
		inspectedIsPlayer = false;
		inspectedCanCombat = false;
	}
}

// Flash the last combat's dice + hit tally as a brief toast.
function showCombatResult(
	attacker: string,
	target: string,
	rolls: number[],
	threshold: number,
	hits: number,
	attackerArt?: string,
	targetArt?: string
) {
	combatResult = { attacker, target, attackerArt, targetArt, rolls, threshold, hits };

	if (combatResultTimer) clearTimeout(combatResultTimer);
	combatResultTimer = setTimeout(() => {
		combatResult = null;
		combatBoxHits = null;
	}, 4000);
}

// One d6 per ATK point, rolled with a plain RNG. Used for the CPU's attacks,
// which resolve silently (it fires many in quick succession during its turn).
function rollAttackDice(count: number): number[] {
	const rolls: number[] = [];
	for (let i = 0; i < count; i++) rolls.push(rollDie(6));
	return rolls;
}

// Roll the player's ATK dice as black dice in the shared 3D box so the attack is
// watched tumbling; the hits are marked white afterwards (see resolveCombat).
// Falls back to a plain RNG if the box isn't ready yet.
async function rollCombatDice(count: number): Promise<number[]> {
	if (diceRoller) return diceRoller.rollPool(count, COMBAT_DICE_COLOR);
	return rollAttackDice(count);
}

// Apply a pre-rolled attack from `attacker` onto whatever stands at (x, y): a
// rival creature (each die at/above the target's defense costs 1 HP) or the
// rival's origin cell (any die at/above its remaining LP takes exactly 1 life
// point). Applies the damage, ends the match if an origin falls, and returns the
// tally for the combat panel — or null if there was no valid target on the cell.
// The dice are rolled by the caller so the player's roll can run through the 3D
// box (black) while the CPU rolls silently.
function applyAttack(
	attacker: PlacedUnit,
	x: number,
	y: number,
	rolls: number[]
): { target: string; targetArt?: string; threshold: number; hits: number } | null {
	const target = unitAt(x, y);
	const rivalOrigin = rivalOriginFor(attacker.side);

	if (target && target.side !== attacker.side) {
		// A die at or above the target's defense is a hit; each hit costs 1 HP.
		const threshold = target.creature.def;
		const hits = rolls.filter((r) => r >= threshold).length;

		applyDamageToUnit(target, hits);

		return { target: target.creature.name, targetArt: target.creature.billboard, threshold, hits };
	}

	if (rivalOrigin && x === rivalOrigin.x && y === rivalOrigin.y && rivalOrigin.lp > 0) {
		// Origin cell: any single die at or above its remaining LP takes 1 LP, and
		// only ever 1 LP per attack.
		const threshold = rivalOrigin.lp;
		const hits = rolls.some((r) => r >= threshold) ? 1 : 0;
		const targetName = rivalOrigin.side === 'player' ? 'Player origin' : 'Rival origin';

		if (hits > 0) {
			rivalOrigin.lp -= 1;
			updateOriginLP(rivalOrigin);
			checkGameOver();
		}

		return { target: targetName, threshold, hits };
	}

	// Target vanished before the strike landed (e.g. already destroyed).
	return null;
}

// Resolve the player's Combat action on the target at (x, y): roll the ATK dice
// as black dice in the shared 3D box, apply the hits, mark the winning dice as
// white result squares over the box, show the combat panel and charge the cost.
async function resolveCombat(x: number, y: number) {
	const attacker = attackingUnit;
	if (!attacker) return;

	restoreCombatHighlight();
	exitCombatFocus();

	// Leave combat targeting now — the roll is async and shouldn't keep the board
	// locked in combat mode while the dice tumble.
	combating = false;
	attackingUnit = null;

	// Drop any earlier combat marks before this roll takes over the box.
	combatBoxHits = null;

	// Roll the attacker's ATK dice as black dice in the shared 3D box.
	const rolls = await rollCombatDice(attacker.creature.atk);

	const result = applyAttack(attacker, x, y, rolls);

	if (result) {
		// Pay the combat cost out of the energy pool.
		energyPoints -= attacker.creature.cost;

		// Stamp the winning dice (at/above the target's defense) as white result
		// squares over the black dice still shown in the box.
		combatBoxHits = rolls.filter((r) => r >= result.threshold);

		showCombatResult(
			attacker.creature.name,
			result.target,
			rolls,
			result.threshold,
			result.hits,
			attacker.creature.billboard,
			result.targetArt
		);
	}
}

// --- CPU rival turn ---

// One thing the rival can legally do this turn: summon a creature onto a
// tile/rotation, relocate one of its units to a reachable tile, or attack a
// player creature / the player's origin within one of its units' reach.
interface CpuMove {
	type: 'summon' | 'move' | 'combat';
	creature: IGameCreature;
	x: number;
	y: number;
	cost: number;
	// Summon only: the (already-rotated) dice-net shape to stamp.
	offsets?: Array<[number, number]>;
	// Move / combat: the unit being relocated or the attacker.
	unit?: PlacedUnit;
}

// Every valid move available to the rival given its current energy: affordable,
// unplaced creatures at any tile/rotation that extends the blue network, plus
// relocations of its placed units onto any reachable painted tile.
function enumerateCpuMoves(): CpuMove[] {
	const moves: CpuMove[] = [];

	for (const creature of cpuHand) {
		if (creature.cost > cpuEnergy) continue;

		for (let rot = 0; rot < 4; rot++) {
			const offsets = offsetsForRotation(rot);

			for (let y = 0; y < GRID_HEIGHT; y++) {
				for (let x = 0; x < GRID_WIDTH; x++) {
					if (canPlaceForColor(x, y, CELL_BLUE, offsets)) {
						moves.push({ type: 'summon', creature, x, y, cost: creature.cost, offsets });
					}
				}
			}
		}
	}

	for (const unit of placedUnits.values()) {
		if (unit.side !== 'cpu') continue;
		if (unit.creature.cost > cpuEnergy) continue;

		for (const key of moveTargetsFor(unit)) {
			const [x, y] = key.split(',').map(Number);
			moves.push({ type: 'move', creature: unit.creature, x, y, cost: unit.creature.cost, unit });
		}

		// Attacks on player creatures / the player's origin within this unit's reach.
		for (const key of combatTargetsFor(unit)) {
			const [x, y] = key.split(',').map(Number);
			moves.push({ type: 'combat', creature: unit.creature, x, y, cost: unit.creature.cost, unit });
		}
	}

	return moves;
}

// --- CPU move evaluation ---
//
// The rival plays to a single win condition: draining the player's origin cell
// (its `rivalOriginFor('cpu')`, the red core) of its life points. Every move is
// scored by how much it advances that goal, and the turn greedily takes the
// best-scoring move each step. All the moves it chooses among come from
// enumerateCpuMoves, so it never bends the range / movement / combat / energy
// rules the player plays by — it just chooses among the legal options well.

// Probability a single d6 lands at or above `threshold` (the value a die must
// meet to count as a hit). 1+ always hits; 7+ never does.
function pSingleDie(threshold: number): number {
	const faces = Math.max(0, Math.min(6, 7 - threshold));
	return faces / 6;
}

// Probability at least one of `count` d6 lands at or above `threshold` — used to
// judge an attack on the origin cell, which loses exactly 1 LP when any die
// clears its remaining LP.
function pAnyDie(threshold: number, count: number): number {
	return 1 - Math.pow(1 - pSingleDie(threshold), count);
}

// Grid distance (in orthogonal steps) from a cell to the player origin the rival
// is trying to destroy. Infinity when that origin isn't on the board.
function distanceToTargetOrigin(x: number, y: number): number {
	const origin = rivalOriginFor('cpu');
	if (!origin) return Number.POSITIVE_INFINITY;
	return Math.abs(origin.x - x) + Math.abs(origin.y - y);
}

// Score a candidate rival move: higher is more valuable toward the win
// condition. The bands are deliberately far apart so the priority order is
// stable — striking the origin beats removing a blocker, which beats advancing
// toward the origin, which beats plain development.
function scoreCpuMove(move: CpuMove): number {
	const targetOrigin = rivalOriginFor('cpu');

	if (move.type === 'combat' && move.unit) {
		const atk = move.unit.creature.atk;

		// Attacking the player's origin — the only way to actually win. Each strike
		// can shave exactly 1 LP, so this dominates every other move whenever it's
		// possible, and the finishing blow (origin down to its last point) is the
		// single most valuable thing the rival can do.
		if (targetOrigin && move.x === targetOrigin.x && move.y === targetOrigin.y) {
			const landChance = pAnyDie(targetOrigin.lp, atk);
			const finisher = targetOrigin.lp <= 1 ? 5000 * landChance : 0;
			return 10000 + landChance * 1000 + finisher;
		}

		// Attacking a player creature: worth it mainly to clear a blocker or kill a
		// real threat. Value it by expected damage, with a bonus when the roll is
		// likely lethal and for the threat (ATK) the creature would otherwise pose.
		const target = unitAt(move.x, move.y);
		if (target) {
			const expectedHits = atk * pSingleDie(target.creature.def);
			const lethal = expectedHits >= target.hp;
			return 500 + expectedHits * 100 + (lethal ? 800 + target.creature.atk * 40 : 0);
		}

		return 0;
	}

	if (move.type === 'move' && move.unit) {
		// Reward closing the gap to the player origin; a lateral or backward step
		// scores nothing so the rival never burns energy shuffling in place.
		const progress =
			distanceToTargetOrigin(move.unit.x, move.unit.y) - distanceToTargetOrigin(move.x, move.y);

		let score = progress * 60;

		// Stepping into strike range of the origin sets up the kill next action.
		if (targetOrigin && targetOrigin.lp > 0 && distanceToTargetOrigin(move.x, move.y) <= move.unit.creature.reach) {
			score += 900;
		}

		// Stepping adjacent-enough to threaten a player creature is a smaller lure.
		for (const other of placedUnits.values()) {
			if (other.side === 'cpu') continue;
			const dist = Math.abs(other.x - move.x) + Math.abs(other.y - move.y);
			if (dist <= move.unit.creature.reach) {
				score += 120;
				break;
			}
		}

		return score;
	}

	if (move.type === 'summon') {
		// Develop toward the origin: summons that plant the network nearer the
		// target, and stronger creatures, are preferred. A summon that lands within
		// strike range of the origin can hammer it on the very next action.
		const dist = distanceToTargetOrigin(move.x, move.y);
		const c = move.creature;
		const stats = c.atk + c.hp + c.speed + c.reach;

		let score = 200 - dist * 8 + stats * 3;

		if (targetOrigin && targetOrigin.lp > 0 && dist <= c.reach) score += 700;

		return score;
	}

	return 0;
}

// Pick the rival's best move for this step, with a tiny jitter so equally-good
// options vary between turns rather than always resolving the same way. Returns
// null when nothing on the board is worth spending energy on (every option is a
// wasteful lateral step), which ends the turn early instead of dumping energy.
function pickCpuMove(moves: CpuMove[]): CpuMove | null {
	let best: CpuMove | null = null;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const move of moves) {
		const score = scoreCpuMove(move) + Math.random() * 4;
		if (score > bestScore) {
			bestScore = score;
			best = move;
		}
	}

	return bestScore > 10 ? best : null;
}

// Take the rival's turn: roll its energy, then repeatedly pick the best valid
// move and pay for it until no worthwhile affordable move remains (capped so a
// large deck can't loop forever). Runs when the player ends their turn.
async function runCpuTurn() {
	if (rivalThinking || gameOver) return;
	rivalThinking = true;

	// The rival's dice are about to take over the shared box; drop any lingering
	// player combat marks so they don't sit over the rival's rolls.
	combatBoxHits = null;

	// Start-of-turn draw: refill the rival's hand from its deck up to HAND_SIZE.
	drawCpuHand();

	try {
		// Same 3d6 energy roll the player gets each turn, rolled in the shared 3D
		// dice box tinted blue so it reads as the rival's. Falls back to a plain
		// RNG if the box isn't ready. The faces are mirrored in the panel too.
		const rivalRoll = diceRoller
			? await diceRoller.rollPool(3, RIVAL_DICE_COLOR)
			: [rollDie(6), rollDie(6), rollDie(6)];
		rivalFaces = rivalRoll;
		cpuEnergy = rivalRoll.reduce((sum, face) => sum + face, 0);

		for (let step = 0; step < 12; step++) {
			// Stop the moment the match is decided (e.g. the rival just destroyed the
			// player's origin) so it can't keep acting past the game-over.
			if (gameOver) break;

			const moves = enumerateCpuMoves();
			if (!moves.length) break;

			// Choose the move that best advances the win condition (drain the player's
			// origin) rather than a random legal one. A null pick means nothing left is
			// worth the energy, so the rival stops instead of flailing.
			const move = pickCpuMove(moves);
			if (!move) break;

			if (move.type === 'summon') {
				await placeMonster(move.creature, move.x, move.y, 'cpu', CELL_BLUE, move.offsets!);
				// The summoned card leaves the rival's hand (it's now on the board).
				cpuHand = cpuHand.filter((c) => c.id !== move.creature.id);
			} else if (move.type === 'combat' && move.unit) {
				// The CPU rolls its attack silently (no 3D box) during its turn.
				const rolls = rollAttackDice(move.unit.creature.atk);
				const result = applyAttack(move.unit, move.x, move.y, rolls);
				if (result) {
					showCombatResult(
						move.unit.creature.name,
						result.target,
						rolls,
						result.threshold,
						result.hits,
						move.unit.creature.billboard,
						result.targetArt
					);
				}
			} else if (move.unit) {
				relocateUnit(move.unit, move.x, move.y);
			}

			cpuEnergy -= move.cost;

			// Pace the actions so the player can watch the rival move one at a time.
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
	} finally {
		rivalThinking = false;
		// Both sides have now acted on this turn; advance the shared turn number.
		turnNumber += 1;
		// The player's next turn begins now — refill their hand from the deck up to
		// HAND_SIZE so drawn cards are ready before they roll and act.
		drawPlayerHand();
	}
}

// Toggle unfold mode from the left panel's "Unfold" button. Entering it lets the
// next click on a legal tile stamp the dice net's floor onto the player's red
// network (no creature summoned) for a fixed energy cost; clicking the button
// again cancels. Summoning and unfolding are mutually exclusive net actions.
function startUnfold() {
	if (unfolding) {
		unfolding = false;
		netRotation = 0;
		clearPreview();
		return;
	}

	// Can't unfold mid-move/combat, during the rival's turn, or without the energy.
	if (moving || combating || rivalThinking) return;
	if (energyPoints < UNFOLD_COST) return;

	// Drop any selected creature so only the plain net previews.
	selectedMonster = null;
	netRotation = 0;
	unfolding = true;
}

// Preview just the unfolded dice net's "T" floor at 50% opacity for the current
// rotation at the given tile — tinted red where the placement is legal and gray
// where not. Shared by creature summoning (which then adds a ghost sprite) and
// the plain Unfold action (floor only, no sprite).
function showNetPreview(gridX: number, gridY: number) {
	clearPreview();

	// A legal placement extends the red network; an illegal one previews gray.
	const previewTint = canPlaceAt(gridX, gridY) ? CELL_RED : 0x666666;

	// Preview the "T" tiles at 50% opacity. Net squares that fall on a cell that
	// already has ground are skipped from the preview too — the net won't lay floor
	// there, so it must not appear to. Only the empty cells it would actually paint
	// are tinted (clearPreview restores them once the pointer leaves).
	for (const [dx, dy] of rotatedOffsets()) {
		const x = gridX + dx;
		const y = gridY + dy;
		const key = tileKey(x, y);

		if (occupied.has(key)) continue;

		const tile = tiles.get(key);
		if (!tile) continue;

		tile.tint = previewTint;
		tile.alpha = 0.5;
		previewTiles.push(key);
	}
}

// Show a 50%-opacity ghost of the selected card's billboard over its unfolded
// "T" floor at the tile it would be placed on.
async function showPreview(
	texturePath: string,
	gridX: number,
	gridY: number
) {
	showNetPreview(gridX, gridY);

	const token = ++previewToken;

	// Ghost billboard sprite at the crossroads.
	const texture = await Assets.load(texturePath);

	// Pointer already left / another preview started while loading.
	if (token !== previewToken) return;

	if (!previewSprite) {
		previewSprite = new Sprite(texture);
		// Match the placed sprite: bottom edge anchored to the cell center.
		previewSprite.anchor.set(0.5, 1);
		previewSprite.alpha = 0.5;
		units.addChild(previewSprite);
	} else {
		previewSprite.texture = texture;
	}

	previewSprite.scale.set(TILE_WIDTH / texture.width);

	const isoX = (gridX - gridY) * (TILE_WIDTH / 2);
	const isoY = (gridX + gridY) * (TILE_HEIGHT / 2);
	previewSprite.position.set(isoX, isoY);
	// Sort the ghost by its hover row too, so it previews at the correct depth.
	previewSprite.zIndex = depthFor(gridX, gridY);
	previewSprite.visible = true;
}

// Restore any tiles/sprite touched by the hover preview.
function clearPreview() {
	previewToken++;

	for (const key of previewTiles) {
		const tile = tiles.get(key);
		if (!tile) continue;

		const color = occupied.get(key);
		if (color !== undefined) {
			tile.alpha = 1;
			tile.tint = color;
		} else {
			tile.alpha = 0;
			tile.tint = 0xffffff;
		}
	}

	previewTiles = [];

	if (previewSprite) {
		previewSprite.visible = false;
	}
}


	onMount(() => {
		loadDeck();
		loadCpuDeck();


		let dragging = false;
		let lastX = 0;
		let lastY = 0;

		async function init() {
			await app.init({
				// Follow the square host element (side = viewport height) so the canvas
				// stays a perfect square and re-fits when the window resizes.
				resizeTo: host,
				background: '#1b1b1b',
				antialias: true
			});

			host.appendChild(app.canvas);

			camera = new Container();

grid = new Container();
// Render every grid-line outline above every floor tile (see zIndex assignments
// in buildGrid), so painted floor never covers a neighboring cell's lines.
grid.sortableChildren = true;
labels = new Container();
shadows = new Container();
units = new Container();
// Depth-sort creature sprites by their screen row: a unit lower on the board
// (greater isoY, used as its zIndex) renders above one higher up, so nearer
// creatures correctly overlap farther ones (see depthFor / placeMonster).
units.sortableChildren = true;
overlays = new Container();

camera.addChild(grid);
camera.addChild(labels);
camera.addChild(shadows);
camera.addChild(units);
camera.addChild(overlays);

app.stage.addChild(camera);

			frameBoard();


			buildGrid();

			buildLabels();

			// Permanently record the pre-painted cells (last column = x GRID_WIDTH - 1):
			// red origin at (row 1 = y 0), blue origin at the opposite corner.
			paintCell(GRID_WIDTH - 1, 0, CELL_RED);
			paintCell(0, GRID_HEIGHT - 1, CELL_BLUE);

			// Load the hearts icon (same one the card renderer uses for HP) so each
			// origin's LP can be drawn as a vertical stack of hearts.
			heartTexture = await Assets.load('/assets/icons/skoll/hearts.svg');

			// Each origin cell starts with 3 life points, shown as a stack of hearts.
			// Kept as destroyable OriginCells so combat can whittle their life down.
			redOrigin = {
				x: GRID_WIDTH - 1,
				y: 0,
				side: 'player',
				color: CELL_RED,
				lp: ORIGIN_LP,
				hearts: drawOriginHearts(GRID_WIDTH - 1, 0, ORIGIN_LP)
			};
			blueOrigin = {
				x: 0,
				y: GRID_HEIGHT - 1,
				side: 'cpu',
				color: CELL_BLUE,
				lp: ORIGIN_LP,
				hearts: drawOriginHearts(0, GRID_HEIGHT - 1, ORIGIN_LP)
			};

			setupControls();

			app.renderer.on('resize', () => {});
		}

		function buildGrid() {
			for (let y = 0; y < GRID_HEIGHT; y++) {
				for (let x = 0; x < GRID_WIDTH; x++) {
					const isoX = (x - y) * (TILE_WIDTH / 2);
					const isoY = (x + y) * (TILE_HEIGHT / 2);

					const drawDiamond = (g: Graphics) =>
						g
							.moveTo(0, -TILE_HEIGHT / 2)
							.lineTo(TILE_WIDTH / 2, 0)
							.lineTo(0, TILE_HEIGHT / 2)
							.lineTo(-TILE_WIDTH / 2, 0)
							.closePath();

					// Always-visible cell outline (no fill) keeps the grid legible. Its
					// higher zIndex keeps the grid lines above every floor tile.
					const outline = new Graphics();
					drawDiamond(outline).stroke({ width: 1, color: 0xffffff, alpha: 1 });
					outline.position.set(isoX, isoY);
					outline.zIndex = 1;
					grid.addChild(outline);

					// Interactive fill, empty (transparent) by default; revealed by
					// raising alpha + tinting on hover, preview and placement.
					const tile = new Graphics();
					drawDiamond(tile).fill(0xffffff);
					tile.position.set(isoX, isoY);
					tile.alpha = 0;
					tile.zIndex = 0;

					tile.on('pointertap', async () => {
	// The board is locked once the match is decided.
	if (gameOver) return;

	// Move mode: clicking a highlighted destination relocates the unit.
	if (moving) {
		if (moveHighlight.includes(tileKey(x, y))) completeMove(x, y);
		return;
	}

	// Combat mode: clicking a highlighted target resolves the attack.
	if (combating) {
		if (combatHighlight.includes(tileKey(x, y))) resolveCombat(x, y);
		return;
	}

	// The player can't summon or unfold while the rival is taking its turn.
	if (rivalThinking) return;

	// Unfold mode: clicking a legal tile stamps the dice net's floor onto the
	// player's red network — no creature summoned — for a fixed energy cost.
	if (unfolding) {
		if (energyPoints < UNFOLD_COST) return;
		if (!canPlaceAt(x, y)) return;

		const offsets = rotatedOffsets();

		// Leave unfold mode and drop the hover preview the instant the tile is
		// committed, before painting the floor.
		unfolding = false;
		netRotation = 0;
		clearPreview();

		// The net only lays new floor: squares that fall on a cell that already
		// has ground are skipped rather than repainted.
		for (const [dx, dy] of offsets) {
			const nx = x + dx;
			const ny = y + dy;
			if (occupied.has(tileKey(nx, ny))) continue;
			paintCell(nx, ny, CELL_RED);
		}

		energyPoints -= UNFOLD_COST;
		return;
	}

	const monster = selectedMonster;
	if (!monster?.billboard) return;

	// Not enough energy to summon this monster: ignore the placement.
	if (monster.cost > energyPoints) return;

	// The dice net must extend the red network from an adjacent red tile.
	if (!canPlaceAt(x, y)) return;

	// Snapshot the net shape at the current orientation before it's reset below.
	const offsets = rotatedOffsets();

	// Drop selection + hover preview the instant the tile is committed, before
	// the (async) summon sequence runs. This makes the ghost billboard and its
	// unfolded net path stop showing right away — and, by clearing the selection,
	// stops pointerover from re-showing the preview while the summon animation and
	// dice roll play out. With no selection the wheel controls zoom again.
	selectedMonster = null;
	netRotation = 0;
	clearPreview();

	// Remove the summoned card from the hand immediately — before the (async)
	// summon sequence — so it drops out of the right-side tray the instant the tile
	// is clicked, rather than lingering through the fade-in and HP dice roll.
	hand = hand.filter((c) => c.id !== monster.id);

	// Lock the right-side column for the whole summon sequence so no other card
	// can be summoned until this one is on the board with its rolled HP. Cleared
	// in finally so a failed texture/HP roll can't leave the tray stuck disabled.
	summoning = true;
	try {
		const unit = await placeMonster(monster, x, y, 'player', CELL_RED, offsets);

		// Pay the summon cost out of the energy pool.
		energyPoints -= monster.cost;

		// Now the creature is on the board with its rolled HP, re-point the detail
		// panel at the placed unit so its Move/Combat/Effect buttons reflect the live
		// unit (energy, combat reach) instead of the inspect-only hand card. Only when
		// the panel is still showing the summoned card — if another creature was
		// clicked while the HP rolled, leave that inspection alone.
		if (unit && inspectedCreature === monster) {
			inspectedUnit = unit;
			inspectedCreature = unit.creature;
			inspectedIsPlayer = true;
			inspectedCanCombat = combatTargetsFor(unit).length > 0;
		}
	} finally {
		summoning = false;
	}
});

					tile.eventMode = 'static';
					tile.cursor = 'pointer';

					tile.on('pointerover', () => {
	// Remember the hovered cell so a wheel-rotation can redraw the preview.
	hoverTile = { x, y };

	if (selectedMonster?.billboard) {
		showPreview(selectedMonster.billboard, x, y);
	} else if (unfolding) {
		showNetPreview(x, y);
	} else if (!occupied.has(tileKey(x, y))) {
		tile.tint = 0xffcc66;
		tile.alpha = 1;
	}
});

tile.on('pointerout', () => {
	if (hoverTile?.x === x && hoverTile?.y === y) hoverTile = null;

	if (selectedMonster?.billboard || unfolding) {
		clearPreview();
	} else if (!occupied.has(tileKey(x, y))) {
		tile.tint = 0xffffff;
		tile.alpha = 0;
	}
});

					tiles.set(tileKey(x, y), tile);
					grid.addChild(tile);
				}
			}
		}

		// Draw chess-style coordinate labels just outside the diamond grid:
		// letters for columns (x) along the top-right edge, numbers for rows
		// (y) along the top-left edge. Labels live in the camera so they pan
		// and zoom together with the board.
		function buildLabels() {
			const labelStyle = {
				fill: 0xffffff,
				fontSize: 14,
				fontWeight: '700' as const
			};

			const isoPos = (gx: number, gy: number) => ({
				x: (gx - gy) * (TILE_WIDTH / 2),
				y: (gx + gy) * (TILE_HEIGHT / 2)
			});

			// Column letters, one tile north-west of the y = 0 edge.
			for (let x = 0; x < GRID_WIDTH; x++) {
				const text = new Text({ text: columnLabel(x), style: labelStyle });
				text.anchor.set(0.5);

				const { x: isoX, y: isoY } = isoPos(x, -1);
				text.position.set(isoX, isoY);

				labels.addChild(text);
			}

			// Row numbers, one tile north-east of the x = 0 edge.
			for (let y = 0; y < GRID_HEIGHT; y++) {
				const text = new Text({ text: String(y + 1), style: labelStyle });
				text.anchor.set(0.5);

				const { x: isoX, y: isoY } = isoPos(-1, y);
				text.position.set(isoX, isoY);

				labels.addChild(text);
			}
		}

		function setupControls() {
			const canvas = app.canvas;

			canvas.addEventListener('pointerdown', (e) => {
				if (e.button !== 0) return;

				dragging = true;
				lastX = e.clientX;
				lastY = e.clientY;

				canvas.setPointerCapture(e.pointerId);
			});

			canvas.addEventListener('pointermove', (e) => {
				if (!dragging) return;

				const dx = e.clientX - lastX;
				const dy = e.clientY - lastY;

				camera.x += dx;
				camera.y += dy;

				lastX = e.clientX;
				lastY = e.clientY;
			});

			function stopDrag(e: PointerEvent) {
				if (!dragging) return;

				dragging = false;

				if (canvas.hasPointerCapture(e.pointerId)) {
					canvas.releasePointerCapture(e.pointerId);
				}
			}

			canvas.addEventListener('pointerup', stopDrag);
			canvas.addEventListener('pointercancel', stopDrag);

			canvas.addEventListener('pointerleave', () => {
				dragging = false;
			});

			canvas.addEventListener(
				'wheel',
				(e) => {
					e.preventDefault();

					// While a creature is selected for summoning — or the player is
					// unfolding a plain net — the wheel rotates the dice net 90° per
					// notch instead of zooming the board. Zoom control is restored
					// automatically once the net action ends (selection cleared / unfold
					// left).
					if (selectedMonster?.billboard || unfolding) {
						netRotation = (netRotation + (e.deltaY < 0 ? 1 : 3)) % 4;

						if (hoverTile) {
							if (selectedMonster?.billboard) {
								showPreview(selectedMonster.billboard, hoverTile.x, hoverTile.y);
							} else {
								showNetPreview(hoverTile.x, hoverTile.y);
							}
						}

						return;
					}

					const rect = canvas.getBoundingClientRect();

					const mouseX = e.clientX - rect.left;
					const mouseY = e.clientY - rect.top;

					const oldScale = camera.scale.x;

					const worldX = (mouseX - camera.x) / oldScale;
					const worldY = (mouseY - camera.y) / oldScale;

					const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;

					const newScale = Math.max(
						MIN_ZOOM,
						Math.min(MAX_ZOOM, oldScale * zoomFactor)
					);

					camera.scale.set(newScale);

					camera.x = mouseX - worldX * newScale;
					camera.y = mouseY - worldY * newScale;
				},
				{ passive: false }
			);
		}

		init();

		return () => {
			app.destroy(true, {
				children: true
			});
		};
	});
</script>

<svelte:head>
	<title>Isometric Grid</title>
</svelte:head>

<!-- Full-viewport game canvas. -->
<div bind:this={host} class="viewport"></div>

<!-- Left column: the turn / dice panel, laid over the top-left of the canvas. -->
<aside
	bind:this={leftPanel}
	class="fixed top-[var(--navbar-h)] left-0 z-10 flex max-h-[calc(100vh-var(--navbar-h))] flex-col gap-2 overflow-auto p-2"
>
	<div class="rounded bg-base-100 shadow-lg">
		<DiceRoller
			bind:this={diceRoller}
			{energyPoints}
			{rivalFaces}
			rivalEnergy={cpuEnergy}
			{rivalThinking}
			{turnNumber}
			{unfolding}
			combatHits={combatBoxHits}
			onRoll={(total) => (energyPoints += total)}
			onUnfold={startUnfold}
			onEndTurn={runCpuTurn}
		/>
	</div>

	<!-- Combat panel: shown while a recent attack is resolving. Reads the attacker,
	     an arrow, and the defender in a row — with the attacker's ATK, the
	     defender's DEF, and the HP inflicted by the roll. -->
	{#if combatResult}
		<div class="w-56 rounded border bg-base-100 p-3 shadow-lg">
			<div class="mb-2 text-xs font-semibold tracking-wide uppercase opacity-60">Combat</div>

			<div class="flex items-center justify-between gap-1">
				<div class="flex flex-1 flex-col items-center gap-1 text-center">
					<div
						class="flex aspect-square w-14 items-center justify-center overflow-hidden rounded border border-base-300 bg-base-200"
					>
						{#if combatResult.attackerArt}
							<img
								src={combatResult.attackerArt}
								alt={combatResult.attacker}
								class="h-full w-full object-cover"
							/>
						{:else}
							<span class="text-lg opacity-40">?</span>
						{/if}
					</div>
					<span class="line-clamp-2 text-xs font-semibold">{combatResult.attacker}</span>
					<span class="badge badge-error badge-sm gap-1">ATK {combatResult.rolls.length}</span>
				</div>

				<div class="text-2xl leading-none opacity-70">→</div>

				<div class="flex flex-1 flex-col items-center gap-1 text-center">
					<div
						class="flex aspect-square w-14 items-center justify-center overflow-hidden rounded border border-base-300 bg-base-200"
					>
						{#if combatResult.targetArt}
							<img
								src={combatResult.targetArt}
								alt={combatResult.target}
								class="h-full w-full object-cover"
							/>
						{:else}
							<span class="text-lg opacity-40">⌂</span>
						{/if}
					</div>
					<span class="line-clamp-2 text-xs font-semibold">{combatResult.target}</span>
					<span class="badge badge-info badge-sm gap-1">DEF {combatResult.threshold}</span>
				</div>
			</div>

			<div class="mt-3 flex items-center justify-center gap-2 border-t border-base-300 pt-2">
				<span class="text-xs opacity-70">HP inflicted</span>
				<span class="badge badge-success badge-sm font-bold">{combatResult.hits}</span>
			</div>
		</div>
	{/if}
</aside>

<!-- Right column: the on-board detail card + the summonable cards grid, laid over
     the top-right of the canvas. -->
<aside
	bind:this={rightPanel}
	class="fixed top-[var(--navbar-h)] right-0 z-10 flex max-h-[calc(100vh-var(--navbar-h))] w-[400px] flex-col gap-2 overflow-y-auto p-2"
>
	<!-- On-board detail: the last-clicked creature's card and its actions. Always
	     visible — shows a placeholder prompt when no creature is selected. -->
	<div class="grid grid-cols-2 items-start gap-2">
		{#if inspectedCreature}
			<div class="pointer-events-none">
				<GameCard card={inspectedCreature} />
			</div>

			<div class="flex flex-col gap-2">
				{#if inspectedIsPlayer && moving}
					<button class="btn btn-sm btn-error" onclick={cancelMove}>Cancel Move</button>
				{:else if inspectedIsPlayer && combating}
					<button class="btn btn-sm btn-error" onclick={cancelCombat}>Cancel Combat</button>
				{:else}
					<!-- Rival creatures (and the rival's own turn) show the same buttons, all disabled. -->
					<!-- Also disabled while a summon is landing, so no action fires mid-summon. -->
					{@const controlsDisabled = !inspectedIsPlayer || rivalThinking || summoning}
					<button
						class="btn btn-sm btn-primary justify-between"
						disabled={controlsDisabled || energyPoints < inspectedCreature.cost}
						onclick={startMove}
					>
						<span>Move</span>
						<span class="text-xs opacity-80">
							Cost {inspectedCreature.cost} · SPD {inspectedCreature.speed}
						</span>
					</button>
					<button
						class="btn btn-sm btn-primary justify-between"
						disabled={controlsDisabled ||
							energyPoints < inspectedCreature.cost ||
							!inspectedCanCombat}
						onclick={startCombat}
					>
						<span>Combat</span>
						<span class="text-xs opacity-80">
							Cost {inspectedCreature.cost} · ATK {inspectedCreature.atk}d6
						</span>
					</button>
				{/if}
			</div>
		{:else}
			<div
				class="flex aspect-square w-full items-center justify-center rounded border border-dashed border-base-300 bg-base-100/60 p-4 text-center text-sm text-base-content/60"
			>
				Click a creature on the board to inspect it.
			</div>
		{/if}
	</div>

	<div class="divider my-0"></div>

	<!-- Hand header: the drawn hand's count and the remaining draw pile. The deck is
	     shown as a count only — its cards are drawn into the hand at each turn start,
	     not listed here. -->
	<div class="mb-1 flex items-center justify-between px-1">
		<span class="text-xs font-semibold tracking-wide uppercase opacity-60">
			Hand ({hand.length}/{HAND_SIZE})
		</span>
		<span class="badge badge-neutral badge-sm gap-1">Deck: {deck.length}</span>
	</div>

	<!-- Sort controls: one cell per creature attribute. The active sort column is
	     highlighted; clicking cycles asc → desc → off (see toggleSort). -->
	<div class="mb-1 grid grid-cols-5 gap-1">
		{#each sortColumns as col (col.key)}
			<button
				class={classNames('btn btn-xs gap-0.5', {
					'btn-primary': sortKey === col.key,
					'btn-ghost bg-base-100': sortKey !== col.key
				})}
				onclick={() => toggleSort(col.key)}
			>
				<span>{col.label}</span>
				{#if sortKey === col.key}
					<span class="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="grid grid-cols-2 gap-1">
		{#each handCards as card (card.id)}
			<!-- Cards too costly to summon right now (over the energy pool or this
			     turn's cost cap) are shown dimmed and desaturated, with their Select
			     disabled, rather than hidden from the hand. -->
			<!-- Clicking anywhere on the card loads it into the top-right detail panel
			     (inspect-only for hand cards); the Select overlay still summons it. -->
			<div
				class={classNames('relative cursor-pointer transition', {
					'opacity-50 grayscale': !canSummon(card)
				})}
				role="button"
				tabindex="0"
				onclick={() => inspectCard(card)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						inspectCard(card);
					}
				}}
			>
				<GameCard {card}>
					{#snippet overlay()}
						<button
							class="btn btn-sm btn-primary"
							disabled={summoning || !canSummon(card)}
							onclick={() => (selectedMonster = card)}
						>
							{selectedMonster?.id === card.id ? 'Selected' : 'Select'}
						</button>
					{/snippet}
				</GameCard>
			</div>
		{/each}

		{#if !handCards.length}
			<div
				class="col-span-2 rounded border border-dashed border-base-300 bg-base-100/60 p-4 text-center text-sm text-base-content/60"
			>
				{deck.length ? 'Cards will be drawn at the start of your turn.' : 'Your deck is empty.'}
			</div>
		{/if}
	</div>
</aside>

{#if rivalThinking}
	<div class="fixed top-[calc(var(--navbar-h)+0.5rem)] left-1/2 z-20 -translate-x-1/2">
		<div class="badge badge-info gap-2 py-3">
			<span class="loading loading-spinner loading-xs"></span>
			Rival is taking their turn…
		</div>
	</div>
{/if}

{#if combatResult}
	<div class="fixed top-[calc(var(--navbar-h)+3rem)] left-1/2 z-20 -translate-x-1/2">
		<div class="rounded border border-base-300 bg-base-100 px-4 py-2 shadow-lg">
			<div class="text-sm font-semibold">
				{combatResult.attacker} → {combatResult.target}
			</div>
			<div class="mt-1 flex items-center gap-1">
				{#each combatResult.rolls as roll, i (i)}
					<span
						class={classNames(
							'flex h-6 w-6 items-center justify-center rounded border text-xs font-semibold',
							roll >= combatResult.threshold
								? 'border-success bg-success text-success-content'
								: 'border-base-300 bg-base-200 text-base-content/50'
						)}
					>
						{roll}
					</span>
				{/each}
				<span class="ml-2 text-xs opacity-80">
					{combatResult.hits} hit{combatResult.hits === 1 ? '' : 's'} · needs {combatResult.threshold}+
				</span>
			</div>
		</div>
	</div>
{/if}

<!-- Game-over modal: shown the moment one origin core is destroyed. Reports who
     won and the final heart tally of both origins, and offers a rematch. -->
{#if gameOver}
	<div class="modal modal-open z-30">
		<div class="modal-box max-w-md text-center">
			<div
				class={classNames('text-3xl font-black tracking-wide', {
					'text-success': gameOver.winner === 'player',
					'text-error': gameOver.winner === 'cpu'
				})}
			>
				{gameOver.winner === 'player' ? 'Victory!' : 'Defeat'}
			</div>

			<p class="mt-2 text-sm text-base-content/70">
				{gameOver.winner === 'player'
					? 'You destroyed the rival network core.'
					: 'The rival destroyed your network core.'}
			</p>

			<div class="mt-5 flex items-stretch justify-center gap-3">
				<div
					class={classNames('flex-1 rounded-lg border p-3', {
						'border-success bg-success/10': gameOver.winner === 'player',
						'border-base-300 bg-base-200': gameOver.winner !== 'player'
					})}
				>
					<div class="text-xs font-semibold uppercase opacity-70">You</div>
					<div class="mt-1 text-2xl font-bold text-error">
						{'❤'.repeat(gameOver.playerLp) || '—'}
					</div>
					<div class="text-xs opacity-60">{gameOver.playerLp} / {ORIGIN_LP} hearts</div>
				</div>

				<div class="flex items-center text-lg font-bold opacity-50">vs</div>

				<div
					class={classNames('flex-1 rounded-lg border p-3', {
						'border-success bg-success/10': gameOver.winner === 'cpu',
						'border-base-300 bg-base-200': gameOver.winner !== 'cpu'
					})}
				>
					<div class="text-xs font-semibold uppercase opacity-70">Rival</div>
					<div class="mt-1 text-2xl font-bold text-info">
						{'❤'.repeat(gameOver.rivalLp) || '—'}
					</div>
					<div class="text-xs opacity-60">{gameOver.rivalLp} / {ORIGIN_LP} hearts</div>
				</div>
			</div>

			<div class="modal-action justify-center">
				<button class="btn btn-primary" onclick={() => location.reload()}>Play Again</button>
			</div>
		</div>
		<div class="modal-backdrop bg-black/60"></div>
	</div>
{/if}

<style>
	:global(:root) {
		/* Height of the app navbar (DaisyUI .navbar default). Everything on the board
		   is offset by this so the canvas and overlays sit below it, not under it. */
		--navbar-h: 4rem;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #1b1b1b;
	}

	/* The game canvas fills the viewport below the app navbar; the side columns are
	   laid over it, offset by the same navbar height so nothing hides under it. */
	.viewport {
		position: fixed;
		inset: var(--navbar-h) 0 0 0;
	}
</style>