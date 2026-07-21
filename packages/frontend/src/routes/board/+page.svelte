<script lang="ts">
	import { onMount } from 'svelte';
import classNames from 'classnames';
import { Application, Assets, Container, Graphics, Matrix, Sprite, Text, Texture, Ticker } from 'pixi.js';
	import GameCard from '$components/cards/GameCard.svelte';
	import GeneratedCardImage from '$components/cards/GeneratedCardImage.svelte';
	import DiceRoller from '$components/dice/DiceRoller.svelte';

	import type { IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { getDeckById, getPlayerDeck, getCpuDeck } from '$services/deck.service';
	import { enabledCardIds, forcedCardIds } from '$utils/deck/enabledCardIds';
	import { textureForType } from '$utils/card/typeTexture';
	import rollDie from '$utils/dice/rollDie';
	import { Dice3D } from '$utils/dice/dice3d';

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

	// The fixed dice panel floating over the top-left of the canvas, measured on mount
	// so the grid can be framed into the free space beside it (see frameBoard). The
	// right column isn't measured: the canvas viewport reserves its width (--right-col-w)
	// on the right, so it never overlaps the play area.
	let leftPanel = $state<HTMLElement | undefined>();

	// The player's draw pile (cards not yet drawn) and current hand. At the start
	// of each player turn the hand is refilled from the top of the deck up to
	// HAND_SIZE; the deck's remaining count is shown in the right column instead of
	// the old full playable-card list.
	let deck = $state<IGameCreature[]>([]);
	let hand = $state<IGameCreature[]>([]);
	let loading = $state(false);

	// Cards the player has summoned this match, in play order (newest last). Mirrored
	// into the red "player board" plaque drawn on the canvas (see renderPlaque), each
	// rendered as its pre-generated PNG.
	let playedCards = $state<IGameCreature[]>([]);

	// The rival's mirror of playedCards: the cards the CPU has summoned this match,
	// shown in the blue plaque at the top-left end of the grid (see renderPlaque).
	let cpuPlayedCards = $state<IGameCreature[]>([]);

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
	// network (origin L12); the CPU rival commands the blue one (origin A1).
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
		// Purple reference square on the unit's cell — the fixed cell marker the
		// /admin/cards board-preview modal draws (the offset is measured against it),
		// mirrored here so the board matches the preview. Independent of the sprite,
		// so it never moves with the card's x/y offset.
		cellSquare: Graphics;
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

	// Fill color of the translucent overlay laid over reachable destination tiles
	// during move mode (see startMove / moveOverlay).
	const MOVE_TARGET_COLOR = 0x33dd66;

	// Combat mode: true while the player is choosing a target for the attacker
	// shown in the top-right panel. The Combat button toggles to Cancel.
	let combating = $state(false);
	// The attacker (a player unit) and the target tiles it may strike this turn
	// (rival creatures / the rival's origin cell in immediate range). Highlighted
	// while targeting; restored on cancel/resolve.
	let attackingUnit: PlacedUnit | null = null;
	let combatHighlight: string[] = [];
	// The clickable sword icons floating over each combat target while targeting
	// (see createCombatTargetIcon). Rebuilt on startCombat, torn down when combat
	// ends (cancel/resolve, via clearCombatTargetIcons).
	let combatTargetIcons: Container[] = [];
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

	// The board's own 3D dice, rendered directly on the game canvas. `anchorDice`
	// lives in screen space at a fixed spot (bottom-center) for the player's combat
	// rolls; the rest live inside the camera (world space), so they pan and zoom with
	// the board: `playerEnergyDice` / `rivalEnergyDice` sit at each side's origin
	// hearts for the turn-start roll (each side keeps its own so both show at once),
	// and `hpDice` floats above a freshly summoned creature.
	let anchorDice: Dice3D | undefined;
	let playerEnergyDice: Dice3D | undefined;
	let rivalEnergyDice: Dice3D | undefined;
	let hpDice: Dice3D | undefined;

	// The combat box is screen-space and sized in px (its hit-marker overlay is
	// pinned to the same bottom-center spot). The energy/HP boxes are board objects,
	// so they're sized in world units and move with the camera.
	const DICE_BOX_SIZE = 200;
	const DICE_BOTTOM_MARGIN = 24;
	const DICE_WORLD_SIZE = 160; // ≈ 2.5 tiles wide (turn-start energy at the hearts)
	const HP_DICE_WORLD_SIZE = 130; // ≈ 2 tiles wide (HP roll above a creature)

	// True while any on-board dice throw is tumbling — disables End Turn so a turn
	// can't be ended mid-roll.
	let rolling = $state(false);
	// Whether the player has rolled their energy for the current turn yet (the
	// opening roll fires automatically; End Turn stays disabled until it lands).
	let energyRolled = $state(false);

	// The player's red energy dice (matching their red network).
	const ENERGY_DICE_COLOR = '#ff3344';

	// Theme color for the rival's dice in the shared 3D box (blue, matching its
	// blue network), so its rolls read differently from the player's red ones.
	const RIVAL_DICE_COLOR = '#4d8cff';

	// Theme color for a summoned creature's HP dice (green), matching the healthy HP
	// bar the roll fills. Both sides' summons roll their HP with these same dice.
	const HP_DICE_COLOR = '#33dd66';

	// Theme color for the player's combat dice in the shared 3D box: black, so an
	// attack roll reads distinctly from red energy and green HP rolls. The dice that
	// land as hits are then marked with white result squares over the box.
	const COMBAT_DICE_COLOR = '#0f0f0f';

	// Screen-space centre of the fixed dice box (bottom-center of the canvas). The
	// combat-hit markers overlay is pinned to the same spot with Tailwind classes.
	function anchorCenter(): { x: number; y: number } {
		return {
			x: app.screen.width / 2,
			y: app.screen.height - DICE_BOTTOM_MARGIN - DICE_BOX_SIZE / 2
		};
	}

	// Roll `count` dice in the shared anchor box, flipping `rolling` for the throw so
	// End Turn stays disabled while they tumble. Defaults to the fixed bottom-center
	// spot (combat rolls), but callers can pass a `center` to place the throw
	// elsewhere (the turn-start energy rolls sit by each side's origin hearts). Falls
	// back to a plain RNG if the board dice aren't ready yet, so a roll never blocks.
	async function rollAnchor(
		count: number,
		color?: string,
		center: { x: number; y: number } = anchorCenter()
	): Promise<number[]> {
		if (!anchorDice) return Array.from({ length: count }, () => rollDie(6));

		rolling = true;
		try {
			return await anchorDice.roll(count, color, center);
		} finally {
			rolling = false;
		}
	}

	// Roll `count` dice in one of the board-bound boxes (energy / HP), at a world-
	// space `center` so the throw sits on the board and tracks the camera. Flips
	// `rolling` for the throw; falls back to a plain RNG if the box isn't ready.
	async function rollBoard(
		instance: Dice3D | undefined,
		count: number,
		color: string,
		center: { x: number; y: number }
	): Promise<number[]> {
		if (!instance) return Array.from({ length: count }, () => rollDie(6));

		rolling = true;
		try {
			return await instance.roll(count, color, center);
		} finally {
			rolling = false;
		}
	}

	// Roll the player's 3d6 energy for this turn below the player's (red) origin
	// hearts and bank the total. Guarded so it only happens once per turn.
	async function rollPlayerEnergy() {
		if (energyRolled || rolling) return;

		// The energy roll drops any lingering combat marks.
		combatBoxHits = null;

		const center = turnDiceCenterFor(redOrigin, false) ?? { x: 0, y: 0 };
		const faces = await rollBoard(playerEnergyDice, 3, ENERGY_DICE_COLOR, center);
		energyPoints += faces.reduce((sum, face) => sum + face, 0);
		energyRolled = true;
	}

	// Roll the rival's 3d6 energy above the rival's (blue) origin hearts and set its
	// pool. Called at the start of the rival's own turn (see runCpuTurn) — each side
	// rolls on its own turn, never together.
	async function rollRivalEnergy() {
		const center = turnDiceCenterFor(blueOrigin, true) ?? { x: 0, y: 0 };
		const faces = await rollBoard(rivalEnergyDice, 3, RIVAL_DICE_COLOR, center);
		cpuEnergy = faces.reduce((sum, face) => sum + face, 0);
	}

	// End the player's turn: clear the combat dice, hand control to the rival (which
	// rolls and spends its own energy on its turn), then roll the player's energy for
	// their next turn. Driven by the panel's End Turn button.
	async function endTurn() {
		if (rolling || rivalThinking) return;

		anchorDice?.clear();
		energyRolled = false;
		combatBoxHits = null;

		await runCpuTurn();
		await rollPlayerEnergy();
	}

	// World-space centre for a summoned creature's HP dice: the dice sit in a single
	// row at the centre of their (invisible) box, so this returns where that row's
	// centre should land — just above the HP progressbar. The bar's bottom edge sits
	// HP_BAR_GAP above the sprite's top edge (see positionHealthBar) and it grows upward
	// by its own height, so its top edge is that much higher again. The row is placed so
	// its own bottom (centre minus the die half-height) clears the bar's top by the same
	// HP_BAR_GAP — matching the gap between the bar and the top of the creature's red
	// container. World coordinates (the box lives inside the camera), so the dice sit on
	// the board and track pan/zoom.
	function hpDiceCenterFor(sprite: Sprite, count: number): { x: number; y: number } {
		// The progressbar's top edge (mirrors positionHealthBar + the bar's height).
		const barTopY =
			sprite.y - sprite.height * sprite.anchor.y - HP_BAR_GAP - healthBarHeight();
		const dieHalf = hpDice?.diceHalfExtent(count) ?? 0;
		return {
			x: sprite.x,
			// Lift the row's centre so its bottom edge clears the bar's top by HP_BAR_GAP.
			y: barTopY - HP_BAR_GAP - dieHalf
		};
	}

	// World-space centre for a turn-start energy roll, placed right at an origin's
	// heart counter: `above` the rival's (upward-rising) hearts, or below the
	// player's (downward-hanging) ones. The hearts spread across the origin's frame
	// cells; this centres the dice horizontally on that cluster and puts them one
	// grid row past its outermost heart cell — continuing the isometric diagonal, as
	// if the grid kept going — so they sit snug against the hearts. World coordinates,
	// so the dice belong to the board. Null before the origin exists.
	function turnDiceCenterFor(
		origin: OriginCell | null,
		above: boolean
	): { x: number; y: number } | null {
		if (!origin) return null;

		const { x: isoX, y: isoY } = isoPosOf(origin.x, origin.y);
		const offsets = origin.heartOffsets ?? [[0, 0]];

		// Horizontal centre of the heart cluster.
		const avgX = offsets.reduce((sum, [ox]) => sum + ox, 0) / offsets.length;
		// The outermost heart cell (top for the rival, bottom for the player), then two
		// straight grid rows beyond it (each a TILE_HEIGHT step up/down on screen) so
		// the dice clear the hearts entirely instead of overlapping the last one.
		const outerY = above
			? Math.min(...offsets.map(([, oy]) => oy))
			: Math.max(...offsets.map(([, oy]) => oy));
		const rowStep = (above ? -TILE_HEIGHT : TILE_HEIGHT) * 2;

		return {
			x: isoX + avgX,
			y: isoY + outerY + rowStep
		};
	}

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
		const GRID_WIDTH = 12;
		const GRID_HEIGHT = 12;

		// Visual separation between adjacent isometric cells. Each drawn diamond is
		// shrunk toward its own center by this fraction of its half-extents, opening a
		// noticeable gap between neighboring tiles. Only the drawn diamond shrinks —
		// cell centers (and everything positioned by isoPosOf: sprites, shadows,
		// hearts) are unchanged, so gameplay layout is unaffected.
		const CELL_GAP = 0.16;

		// The drawn width of a single cell after the gap is applied. Billboards are
		// sized to this (rather than the full TILE_WIDTH) so a summoned creature's
		// default footprint matches the visible tile it stands on.
		const CELL_WIDTH = TILE_WIDTH * (1 - CELL_GAP);

		const MIN_ZOOM = 0.25;
		const MAX_ZOOM = 4;

		let camera: Container;
let grid: Container;
// Sits below `units` so each creature's shadow ellipse renders on its cell,
// under the sprites.
let shadows: Container;
let units: Container;
// Sits above `units` so HP bars and origin LP counters always render on top of
// the creature sprites.
let overlays: Container;
// Top-most board layer holding the translucent green move-target overlays: one
// diamond drawn over each candidate destination cell while move mode is active,
// torn down when it ends. Because these are separate objects laid over the floor
// (never a repaint of the tile's own tint), the underlying floor is left exactly
// as it was once the overlay is cleared.
let moveOverlay: Container;

// The "player board" plaque is drawn on the canvas as a Pixi object laid flat on
// the isometric ground plane (see playerPlaque / renderPlaque), pinned to the
// bottom-right end of the grid. Living inside the `camera` container, it pans and
// zooms with the board automatically, so it needs no per-frame JS to track it.

// Where the plaque sits, in grid space. Its local top-left corner is anchored to
// this cell; before the 90° turn it spans TAG_COLS cells down the grid's +x axis.
// After the turn its long (TAG_COLS) axis is its text/length running parallel to
// the board's bottom-right edge (the x=11 column, 12 cells tall), and its short
// axis is its thickness poking out past that edge — sized from the played-card
// height rather than a fixed cell count (see TAG_HEIGHT). TAG_COLS is 8 so the
// length leaves a 2-cell gap at each end
// of that 12-cell edge (12 − 2 − 2), and the anchor centers it on the edge's
// midline (grid center y = 5.5). anchor.x = 10 puts the plaque's inner long edge
// (its top, the edge facing the board) at grid x = 12.5 — leaving a one-cell-wide
// gap between it and the grid's bottom-right boundary (x = 11.5), as if a row of
// grid cells sat between them — with its thickness poking outward from there. The
// div's own px size is TILE_WIDTH per cell on each axis, matching the ground
// matrix below.
const TAG_ANCHOR = { x: 10, y: 4 };
const TAG_COLS = 8;
const TAG_WIDTH = TILE_WIDTH * TAG_COLS;

// Layout of the played-card thumbnails inside the plaque's local px space. The
// plaque holds a single row of up to PB_ROW_COUNT cards spanning its full length:
// each card's width is derived so exactly that many fit side-to-side across
// TAG_WIDTH, once the inner padding and the inter-card gaps are removed. Cards
// flow left-to-right and wrap; the plaque's thickness only fits one row (see
// TAG_HEIGHT), so at most PB_ROW_COUNT show at once.
const PB_ROW_COUNT = 5;
const PB_GAP = 6;
const PB_PAD = 8;
const PB_CARD_W = (TAG_WIDTH - PB_PAD * 2 - PB_GAP * (PB_ROW_COUNT - 1)) / PB_ROW_COUNT;
// Generated card PNGs are 1080×1415, so the thumbnail height follows that aspect
// (matching the hand tiles) instead of the old 59:86 print ratio.
const PB_CARD_H = (PB_CARD_W * 1415) / 1080;

// The plaque's short axis (its thickness poking past the board edge) hugs a single
// card's height plus the inner padding above and below it, so the red backing is
// exactly as tall as the card row it holds.
const TAG_HEIGHT = PB_CARD_H + PB_PAD * 2;

// The plaque's anchor cell in world (pre-camera) coordinates — the same mapping
// isoPosOf does, inlined so it doesn't depend on that function's declaration
// order. This is where the plaque's local (0,0) corner lands before the ground
// projection and in-plane spin are applied (see PLAYER_BOARD_MATRIX).
const TAG_ISO_X = (TAG_ANCHOR.x - TAG_ANCHOR.y) * (TILE_WIDTH / 2);
const TAG_ISO_Y = (TAG_ANCHOR.x + TAG_ANCHOR.y) * (TILE_HEIGHT / 2);

// The plaque's local px space (0..TAG_WIDTH, 0..TAG_HEIGHT) projected onto the
// board's ground plane, as a single affine matrix set on the playerPlaque
// container. It composes, in order applied to a local point: a 90° CCW in-plane
// spin about the plaque's center (so its long axis runs along the board's bottom-
// right edge), the isometric ground projection matrix(0.5, 0.25, -0.5, 0.25) — the
// same 2:1 foreshortened, 45°-rotated map drawFloorFill uses for floor art — then a
// translation to the anchor cell (TAG_ISO). Worked through, that reduces to the
// entries below; a,b,c,d are the ground+spin rotation/shear (independent of where
// the plaque sits) and tx/ty carry the anchor offset. Because the container lives
// inside `camera`, the camera's pan/zoom is applied on top for free.
const PLAYER_BOARD_MATRIX = new Matrix(
	0.5,
	-0.25,
	0.5,
	0.25,
	TAG_ISO_X - TAG_HEIGHT / 2,
	TAG_ISO_Y + TAG_WIDTH / 4
);

// The board's center in world (pre-camera) coordinates — the midpoint between the
// two opposite origin corners (red L12 at bottom, blue A1 at top). Inlined like
// TAG_ISO so it doesn't depend on isoPosOf's declaration order. Used to point-reflect
// the player plaque into the rival's mirror below.
const BOARD_CENTER_ISO_X = ((GRID_WIDTH - 1) - (GRID_HEIGHT - 1)) * (TILE_WIDTH / 4);
const BOARD_CENTER_ISO_Y = ((GRID_WIDTH - 1) + (GRID_HEIGHT - 1)) * (TILE_HEIGHT / 4);

// The rival's plaque: the player plaque point-reflected through the board center, so
// it sits at the top-left end of the grid (poking past the A1 corner) exactly as the
// player's mirrors the L12 corner. A point reflection negates the linear part (a 180°
// spin — the cards face the rival) and maps each world point P to 2·center − P, so the
// two plaques are a true mirror of one another. Set on the rivalBoard container in init.
const RIVAL_BOARD_MATRIX = new Matrix(
	-0.5,
	0.25,
	-0.5,
	-0.25,
	2 * BOARD_CENTER_ISO_X - (TAG_ISO_X - TAG_HEIGHT / 2),
	2 * BOARD_CENTER_ISO_Y - (TAG_ISO_Y + TAG_WIDTH / 4)
);

// A card plaque laid flat on the board: the player's red one at the bottom-right, the
// rival's blue one at the top-left. Each holds its live Pixi container (built in init,
// added to `camera`), a token bumped on each render so a slow PNG load from a
// superseded render can't paint stale art, and the border color of its network.
interface CardPlaque {
	container?: Container;
	token: number;
	borderColor: number;
}

const playerPlaque: CardPlaque = { token: 0, borderColor: 0xdc2626 };
const rivalPlaque: CardPlaque = { token: 0, borderColor: 0x4d8cff };

// Rasterization resolution for the plaque's text, matching the crisp-at-max-zoom
// treatment the HP-bar / coordinate labels get inside the zoomable camera.
const LABEL_RESOLUTION =
	MAX_ZOOM * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

// Place one played card on the given plaque at local (x, y): its pre-generated PNG
// (static/cards/generated/<id>.png), or a "card not found" placeholder when that
// bitmap is missing — the same fallback the hand tiles use. The token guards against
// a superseded render, and the sprite is added upright in local space, then sheared
// flat by the container's board matrix along with everything else.
async function addPlaqueCard(
	plaque: CardPlaque,
	card: IGameCreature,
	x: number,
	y: number,
	token: number
) {
	let texture: Texture | null = null;
	try {
		texture = await Assets.load(`/cards/generated/${card.id}.png`);
	} catch {
		texture = null;
	}
	if (token !== plaque.token || !plaque.container) return;

	if (texture) {
		const sprite = new Sprite(texture);
		sprite.width = PB_CARD_W;
		sprite.height = PB_CARD_H;
		sprite.position.set(x, y);
		plaque.container.addChild(sprite);
		return;
	}

	const box = new Graphics()
		.rect(x, y, PB_CARD_W, PB_CARD_H)
		.fill({ color: 0x000000, alpha: 0.3 })
		.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
	plaque.container.addChild(box);

	const label = new Text({
		text: 'card not found',
		style: {
			fill: 0xffffff,
			fontSize: 11,
			align: 'center',
			wordWrap: true,
			wordWrapWidth: PB_CARD_W - 8
		},
		resolution: LABEL_RESOLUTION
	});
	label.anchor.set(0.5);
	label.position.set(x + PB_CARD_W / 2, y + PB_CARD_H / 2);
	plaque.container.addChild(label);
}

// Corner radius (local px) of the plaque's rounded backing and clip mask.
const PB_CORNER_RADIUS = 12;

// (Re)draw a plaque for its list of played cards: a translucent backing with rounded
// corners and the plaque's network border (clipped to its own bounds by a matching
// rounded mask, mirroring the old DOM overflow-hidden), then every played card's PNG
// laid out in wrapping rows. Empty until a card is summoned. Rebuilt from scratch on
// each call; a no-op until the container exists (init calls it once the board is built).
async function renderPlaque(plaque: CardPlaque, cards: IGameCreature[]) {
	if (!plaque.container) return;
	const token = ++plaque.token;

	for (const child of plaque.container.removeChildren()) child.destroy();
	plaque.container.mask = null;

	const bg = new Graphics()
		.roundRect(0, 0, TAG_WIDTH, TAG_HEIGHT, PB_CORNER_RADIUS)
		.fill({ color: 0x000000, alpha: 0.5 })
		.stroke({ width: 2, color: plaque.borderColor, alignment: 1 });
	plaque.container.addChild(bg);

	// Clip anything spilling past the plaque's rounded edges to its shape.
	const mask = new Graphics()
		.roundRect(0, 0, TAG_WIDTH, TAG_HEIGHT, PB_CORNER_RADIUS)
		.fill(0xffffff);
	plaque.container.addChild(mask);
	plaque.container.mask = mask;

	// Flow the cards left-to-right, wrapping to a new row when the next card would
	// cross the plaque's right padding — the canvas mirror of the old flex-wrap row.
	let cx = PB_PAD;
	let cy = PB_PAD;
	for (const card of cards) {
		if (cx + PB_CARD_W > TAG_WIDTH - PB_PAD) {
			cx = PB_PAD;
			cy += PB_CARD_H + PB_GAP;
		}
		await addPlaqueCard(plaque, card, cx, cy, token);
		cx += PB_CARD_W + PB_GAP;
	}
}

// Re-render each on-canvas plaque whenever its side summons a card (its played-cards
// list changes). Guarded inside renderPlaque until the container exists, and init
// triggers the first render of both once the board is built.
$effect(() => {
	// Touch playedCards so this effect re-runs on every player summon.
	void playedCards;
	renderPlaque(playerPlaque, playedCards);
});
$effect(() => {
	// Touch cpuPlayedCards so this effect re-runs on every rival summon.
	void cpuPlayedCards;
	renderPlaque(rivalPlaque, cpuPlayedCards);
});

// The player's hand rendered as upright card PNGs (the same generated bitmaps the
// right sidebar and the board plaques use) as two left-aligned rows at the grid's
// bottom-left. Like the red/blue plaques it lives inside `camera`, so it pans and zooms
// with the board — but unlike them the cards are drawn upright (plain sprites, no
// isometric shear), standing rather than lying flat. Each card is two grid cells wide.
// Calibrated against the on-screen grid: the sprite.width setter on the loaded PNG
// renders at ~2× the nominal value (unlike the .scale.set() the board billboards use),
// so CELL_WIDTH here — not 2 × CELL_WIDTH — spans two drawn (gap-applied) tiles. Its
// height follows the 1080×1415 PNG aspect so the art isn't distorted.
const HAND_CARD_W = CELL_WIDTH;
const HAND_CARD_H = (HAND_CARD_W * 1415) / 1080;
const HAND_CARD_GAP = 6;
// World-px shift of the pyramid below the grid's midline, biasing it toward the
// board's bottom-left corner while keeping every row on-screen.
const HAND_BOTTOM_BIAS = 150;

// The world-space hand row (built in init, added to `camera`) and a token bumped on
// each render so a slow PNG load from a superseded render can't paint a stale card.
let handLayer: Container | undefined;
let handToken = 0;

// Draw one hand card as an upright PNG at world (x, y) (its top-left) from an already-
// loaded texture, or a "card not found" placeholder when the bitmap is missing — the
// same fallback the plaques and hand tiles use. Synchronous: renderHand preloads every
// texture first, so the whole hand is laid down in one atomic pass (no per-card await,
// so a re-render can't leave a half-drawn hand). Cards too costly for the current energy
// pool are dimmed, echoing the sidebar's grayed-out tiles.
function addHandCard(card: IGameCreature, x: number, y: number, texture: Texture | null) {
	if (!handLayer) return;

	const dim = canSummon(card) ? 1 : 0.45;

	if (texture) {
		const sprite = new Sprite(texture);
		sprite.width = HAND_CARD_W;
		sprite.height = HAND_CARD_H;
		sprite.position.set(x, y);
		sprite.alpha = dim;
		handLayer.addChild(sprite);
		return;
	}

	const box = new Graphics()
		.rect(x, y, HAND_CARD_W, HAND_CARD_H)
		.fill({ color: 0x000000, alpha: 0.3 })
		.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
	box.alpha = dim;
	handLayer.addChild(box);

	const label = new Text({
		text: 'card not found',
		style: {
			fill: 0xffffff,
			fontSize: 10,
			align: 'center',
			wordWrap: true,
			wordWrapWidth: HAND_CARD_W - 8
		},
		resolution: LABEL_RESOLUTION
	});
	label.anchor.set(0.5);
	label.alpha = dim;
	label.position.set(x + HAND_CARD_W / 2, y + HAND_CARD_H / 2);
	handLayer.addChild(label);
}

// The player's hand is laid out as two left-aligned rows of 3 cards each
// (6 = HAND_SIZE) — filled in draw order.
const HAND_ROWS = [3, 3];

// (Re)draw the player's hand from scratch for the current `hand` (in draw order), as a
// left-aligned two-row block of upright cards in the board's lower-left. The anchor
// is computed in world coords from the grid's corner cells, so the block tracks the grid
// as the camera pans/zooms, and every row shares the same left edge. Reactive to `hand`
// and `energyPoints` (the latter drives the affordability dim); a no-op until the
// container exists (init creates it once the board is built).
//
// The card PNGs are preloaded in parallel before anything is drawn, then the old cards
// are cleared and the new ones added in a single synchronous pass. A stale token check
// after the load drops a superseded render wholesale — so an energy roll or draw firing
// mid-load can never leave a partially rendered hand (which showed up as missing rows).
async function renderHand() {
	if (!handLayer) return;
	const token = ++handToken;

	if (!hand.length) {
		for (const child of handLayer.removeChildren()) child.destroy();
		return;
	}

	// Left-align the block with the grid's leftmost point (the west vertex of the
	// leftmost cell, first col / last row) and grow the rows downward. isoPosOf gives
	// that cell's center, so the drawn diamond's left tip — the grid's westmost pixel —
	// sits half a drawn tile (HAND_CARD_W / 2 = CELL_WIDTH / 2) further left. The block
	// is tall (two rows of upright cards), so bias its vertical center below the grid's
	// midline (worldCenterY = half the bottom corner's y, since the top corner sits at
	// y=0) — this keeps the whole block in the board's lower-left rather than running
	// off the bottom.
	const leftCorner = isoPosOf(0, GRID_HEIGHT - 1);
	const bottomCorner = isoPosOf(GRID_WIDTH - 1, GRID_HEIGHT - 1);
	const worldCenterY = bottomCorner.y / 2;
	const blockHeight = HAND_ROWS.length * HAND_CARD_H + (HAND_ROWS.length - 1) * HAND_CARD_GAP;

	const leftX = leftCorner.x - HAND_CARD_W / 2;
	const topY = worldCenterY - blockHeight / 2 + HAND_BOTTOM_BIAS;

	// Fix each card's world position up front (in draw order, filling the rows).
	const placements: { card: IGameCreature; x: number; y: number }[] = [];
	let index = 0;
	let rowY = topY;
	for (const count of HAND_ROWS) {
		let x = leftX;
		for (let c = 0; c < count && index < hand.length; c++) {
			placements.push({ card: hand[index], x, y: rowY });
			x += HAND_CARD_W + HAND_CARD_GAP;
			index++;
		}
		rowY += HAND_CARD_H + HAND_CARD_GAP;
	}

	// Preload every card's PNG in parallel (null on a miss → placeholder).
	const textures = await Promise.all(
		placements.map((p) =>
			Assets.load<Texture>(`/cards/generated/${p.card.id}.png`).catch(() => null)
		)
	);

	// A newer render superseded this one while the textures loaded — drop it wholesale.
	if (token !== handToken || !handLayer) return;

	for (const child of handLayer.removeChildren()) child.destroy();
	placements.forEach((p, i) => addHandCard(p.card, p.x, p.y, textures[i]));
}

// Repaint the on-canvas hand whenever the hand changes or the energy pool shifts (so
// the affordability dim tracks the current energy). Guarded until the container exists.
$effect(() => {
	void hand;
	void energyPoints;
	renderHand();
});

// Frame the whole isometric grid into the horizontal gap the two fixed side
// panels leave free, centered in that gap (and vertically in the canvas). Called
// once the board is built so the match opens looking at the play area rather than
// the top-center default. The grid's diamonds span GRID*TILE on each axis and its
// isoX is symmetric about 0, so its world center sits at x=0, y=((H-1)*TILE)/2.
function frameBoard() {
	const worldWidth = GRID_WIDTH * TILE_WIDTH;
	const worldHeight = GRID_HEIGHT * TILE_HEIGHT;
	const worldCenterY = ((GRID_HEIGHT - 1) * TILE_HEIGHT) / 2;

	// The canvas already ends at the right column's left edge (the viewport reserves
	// --right-col-w on the right), so only the left dice panel — which floats over the
	// canvas at top-left — is subtracted here. Its offsetWidth includes padding; falls
	// back to the full canvas before it's measured.
	const leftW = leftPanel?.offsetWidth ?? 0;
	const availableW = Math.max(1, app.screen.width - leftW);

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

// A cell's coordinate in the same letter/number system the old edge headers used:
// its 1-based row number followed by its (capital) column letter (e.g. "1A",
// "10J", "12L"). Painted on a cell while it's hovered.
function cellLabel(x: number, y: number): string {
	return `${y + 1}${columnLabel(x)}`;
}

const tiles = new Map<string, Graphics>();
// The always-visible cell outline (no fill) for each cell, kept so paintCell can
// switch a cell's border from the faint empty state to its network color.
const outlines = new Map<string, Graphics>();

// Half-extents of the drawn (gapped) cell diamond, shared by the grid builder and
// paintCell so an outline redraw matches the geometry buildGrid laid down.
const CELL_HALF_W = (TILE_WIDTH / 2) * (1 - CELL_GAP);
const CELL_HALF_H = (TILE_HEIGHT / 2) * (1 - CELL_GAP);

// Trace the isometric cell diamond onto a Graphics (leaving fill/stroke to the
// caller). Centered on the object's origin like every other cell-anchored shape.
function drawCellDiamond(g: Graphics): Graphics {
	return g
		.moveTo(0, -CELL_HALF_H)
		.lineTo(CELL_HALF_W, 0)
		.lineTo(0, CELL_HALF_H)
		.lineTo(-CELL_HALF_W, 0)
		.closePath();
}

// Cell colors the engine can paint permanently.
const CELL_RED = 0xff0000;
const CELL_BLUE = 0x4d8cff;

// An empty cell's border: white at half opacity, so the grid reads faintly until a
// network claims a cell.
const EMPTY_BORDER_COLOR = 0xffffff;
const EMPTY_BORDER_ALPHA = 0.5;

// Occupied cells and their painted color: tile key -> tint color.
// Placed monsters and the red origin (L12) are red; the blue origin (A1) is blue.
const occupied = new Map<string, number>();

// (Re)stroke a cell's outline diamond in the given color/opacity.
function strokeOutline(outline: Graphics, color: number, alpha: number) {
	drawCellDiamond(outline.clear()).stroke({ width: 1, color, alpha });
}

// Draw a cell's floor fill (leaving the tile's alpha to the caller, so the summon
// unfold can fade it in). When a `texture` is given (a summon passes the played
// monster's card-frame art), the floor is filled with that texture mapped into the
// isometric diamond; otherwise the cell is a flat color tint.
function drawFloorFill(tile: Graphics, color: number, texture?: Texture) {
	if (texture) {
		// Map the texture's square onto the cell diamond so the art lies flat in the
		// board's isometric perspective (rotated 45° and foreshortened 2:1) rather than
		// sitting upright. The texture corners land on the diamond vertices: (0,0)→top,
		// (w,0)→right, (w,h)→bottom, (0,h)→left. That parallelogram map is exactly the
		// isometric ground projection of a flat square.
		const matrix = new Matrix(
			CELL_HALF_W / texture.width,
			CELL_HALF_H / texture.width,
			-CELL_HALF_W / texture.height,
			CELL_HALF_H / texture.height,
			0,
			-CELL_HALF_H
		);
		tile.clear();
		drawCellDiamond(tile).fill({ texture, matrix });
		// Lighten the floor with a 10% white overlay over the texture, so the card art
		// reads as a subtle floor material rather than at full strength.
		drawCellDiamond(tile).fill({ color: 0xffffff, alpha: 0.1 });
		// The base fill was tinted white for the flat-color path; reset it so the
		// texture shows its true colors.
		tile.tint = 0xffffff;
	} else {
		tile.tint = color;
	}
}

// Paint a cell its recorded color and remember it as occupied. The cell's outline
// switches from the faint empty border to its network color at full opacity, and its
// floor is drawn (textured or flat) fully opaque at once. The staggered summon uses
// unfoldFloorCell instead; this is the instant path (origins, the Unfold action).
function paintCell(x: number, y: number, color: number, texture?: Texture) {
	const key = tileKey(x, y);
	occupied.set(key, color);

	// The claimed cell's border takes on its network color at full opacity.
	const outline = outlines.get(key);
	if (outline) strokeOutline(outline, color, 1);

	const tile = tiles.get(key);
	if (!tile) return;

	drawFloorFill(tile, color, texture);
	tile.alpha = 1;
}

// Per-cell fade duration and the delay between successive cells for the staggered
// summon "unfold", where a creature's floor materializes outward from its own cell.
const FLOOR_FADE_MS = 200;
const FLOOR_STAGGER_MS = 80;

// Reveal one floor cell for the staggered summon unfold: draw its floor starting
// transparent, fade it in over `ms` (after `delay`), then lock its border to the
// network color as the panel lands. Occupancy is recorded up front by the caller, so
// this only animates the visuals. Resolves once the fade finishes.
function unfoldFloorCell(
	x: number,
	y: number,
	color: number,
	texture: Texture | undefined,
	ms: number,
	delay: number
): Promise<void> {
	const key = tileKey(x, y);
	const tile = tiles.get(key);
	const outline = outlines.get(key);
	if (!tile) return Promise.resolve();

	drawFloorFill(tile, color, texture);
	tile.alpha = 0;

	return new Promise((resolve) => {
		const start = performance.now() + delay;

		const tick = (ticker: Ticker) => {
			void ticker;
			const t = (performance.now() - start) / ms;
			// Hold transparent through the pre-roll delay, then fade in.
			if (t < 0) return;
			tile.alpha = Math.min(1, t);

			if (t >= 1) {
				app.ticker.remove(tick);
				// Lock the cell's border to its network color as the panel lands.
				if (outline) strokeOutline(outline, color, 1);
				resolve();
			}
		};

		app.ticker.add(tick);
	});
}

// Life points the two origin cells (red = L12, blue = A1) start with.
const ORIGIN_LP = 3;

// A destroyable origin cell: its grid position, network side/color, remaining
// life points and the heart stack drawn over it as its LP counter (one heart per
// point, rebuilt as it takes hits).
interface OriginCell {
	x: number;
	y: number;
	side: Side;
	color: number;
	lp: number;
	hearts: Container;
	// Optional per-heart world-space offsets (from the cell center) for the LP
	// counter. When set, the hearts are laid out one per offset instead of the
	// default vertical stack — used by the corner origins to spread their hearts
	// onto the three grid cells framing them.
	heartOffsets?: Array<[number, number]>;
	// Optional anchor point for the hearts (a fraction of the texture height). The
	// red corner origin uses HEART_TOP_Y so its hearts hang downward, mirroring the
	// blue origin's upward hearts; defaults to HEART_TIP_Y (rise upward).
	heartAnchorY?: number;
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

// Per-card board customizations authored in the /admin/cards board-preview modal
// and baked into the catalog, applied here so a creature renders on the board
// exactly as it previews there. `sizeOf` is the billboard scale multiplier (1 =
// default), and `offsetOf` is its x/y nudge (in world px) from the cell center.
function sizeOf(creature: IGameCreature): number {
	return creature.size && creature.size > 0 ? creature.size : 1;
}
function offsetOf(creature: IGameCreature): { x: number; y: number } {
	// The authored offset was calibrated against a full TILE_WIDTH cell in the
	// /admin/cards preview. The board's cells (and the purple reference square) are
	// now shrunk by CELL_GAP, so scale the offset by the same factor to keep the
	// image's placement relative to the square identical to the calibration.
	return {
		x: (creature.x ?? 0) * (1 - CELL_GAP),
		y: (creature.y ?? 0) * (1 - CELL_GAP)
	};
}

// The world position of a creature's sprite on a given cell: the cell center plus
// the card's authored x/y offset. Used wherever the sprite (and things that track
// it) are placed, so a summon and a later move keep the same offset.
function spritePosOf(creature: IGameCreature, x: number, y: number) {
	const { x: isoX, y: isoY } = isoPosOf(x, y);
	const { x: ox, y: oy } = offsetOf(creature);
	return { x: isoX + ox, y: isoY + oy };
}

// The hearts icon shared with the card renderer (GameCard uses it for HP),
// loaded once in init and stacked over each origin cell as its LP counter.
let heartTexture: Texture | null = null;

// The broadsword icon the cards use for their ATK stat (see GameCard), loaded
// once in init and floated over each combat target as its clickable attack
// handle (see createCombatTargetIcon).
let swordTexture: Texture | null = null;

// In the 512px hearts viewBox the bottom tip sits at y≈480.785 and the top of
// the lobes at y≈31, so the drawn heart is ~0.878 of the box tall.
const HEART_TIP_Y = 480.785 / 512;
const HEART_TOP_Y = 31 / 512;
const HEART_VISIBLE_H = (480.785 - 31) / 512;
// Vertical gap left between two stacked hearts, in world px.
const HEART_STACK_GAP = 2;

// One heart sized to the tile, anchored so that `anchorY` (a fraction of the
// texture height) lands on the sprite's position. The default HEART_TIP_Y pins
// the bottom tip to the position so the heart rises upward from it; passing
// HEART_TOP_Y instead pins the top of the lobes so the heart hangs downward.
function heartSprite(anchorY: number = HEART_TIP_Y): Sprite {
	const icon = new Sprite(heartTexture!);
	icon.anchor.set(0.5, anchorY);
	icon.scale.set(TILE_HEIGHT / heartTexture!.height);
	return icon;
}

// World-space offsets (from a cell's center) to the centers of the three grid
// cells framing its top on the isometric board — top-left (grid x-1,y),
// top (grid x-1,y-1) and top-right (grid x,y-1). Used to spread the blue corner
// origin's LP hearts onto the cells above it instead of stacking them.
const TOP_FRAME_HEART_OFFSETS: Array<[number, number]> = [
	[-(TILE_WIDTH / 2), -(TILE_HEIGHT / 2)], // top-left  (NW neighbor)
	[0, -TILE_HEIGHT], // top       (N neighbor)
	[TILE_WIDTH / 2, -(TILE_HEIGHT / 2)] // top-right (NE neighbor)
];

// The vertical mirror of TOP_FRAME_HEART_OFFSETS: the three grid cells framing a
// cell's bottom — bottom-left (grid x,y+1), bottom (grid x+1,y+1) and
// bottom-right (grid x+1,y). Used to spread the red corner origin's LP hearts
// onto the cells below it.
const BOTTOM_FRAME_HEART_OFFSETS: Array<[number, number]> = [
	[-(TILE_WIDTH / 2), TILE_HEIGHT / 2], // bottom-left  (SW neighbor)
	[0, TILE_HEIGHT], // bottom       (S neighbor)
	[TILE_WIDTH / 2, TILE_HEIGHT / 2] // bottom-right (SE neighbor)
];

// (Re)fill a container with one heart per life point. By default the hearts are
// stacked vertically — the bottom heart's tip sits at the container origin and
// each further heart rises above it. When `offsets` is given, heart i is instead
// placed at that world-space offset from the origin (one heart per offset), so
// the counter can be spread across neighboring cells.
function fillHearts(
	container: Container,
	lp: number,
	offsets?: Array<[number, number]>,
	anchorY: number = HEART_TIP_Y
) {
	for (const child of container.removeChildren()) child.destroy();

	const step = TILE_HEIGHT * HEART_VISIBLE_H + HEART_STACK_GAP;

	for (let i = 0; i < lp; i++) {
		const heart = heartSprite(anchorY);

		if (offsets) {
			const [ox, oy] = offsets[i] ?? [0, 0];
			heart.position.set(ox, oy);
		} else {
			heart.position.set(0, -i * step);
		}

		container.addChild(heart);
	}
}

// Build an origin cell's LP counter as hearts (one per life point) anchored on
// the cell, returning the container so combat can rebuild it as the origin loses
// life. Hearts stack vertically by default; passing `offsets` spreads them onto
// the surrounding cells (see TOP_FRAME_HEART_OFFSETS).
function drawOriginHearts(
	x: number,
	y: number,
	lp: number,
	offsets?: Array<[number, number]>,
	anchorY: number = HEART_TIP_Y
): Container {
	if (!heartTexture) return new Container();

	const { x: isoX, y: isoY } = isoPosOf(x, y);

	const container = new Container();
	container.position.set(isoX, isoY);
	overlays.addChild(container);

	fillHearts(container, lp, offsets, anchorY);

	return container;
}

// HP progressbar dimensions (in board/world units, before camera zoom). The bar
// spans the full width of the purple cell-reference square drawn under each unit
// (CELL_WIDTH — see createCellSquare), so it reads as the monster's own footprint.
// Its height is no longer fixed: it hugs the HP text it backs (see healthBarHeight),
// with HP_BAR_HEIGHT kept only as a fallback before the label has measured.
const HP_BAR_WIDTH = CELL_WIDTH;
const HP_BAR_HEIGHT = 6;

// Vertical padding (world units, per side) between the HP text and the top/bottom
// edges of the progressbar that backs it.
const HP_BAR_PADDING_Y = 2;

// Every HP bar is the same height — the label's font never changes — so measure it
// once from a throwaway label and cache it. Kept constant (independent of the bar's
// current text) so the empty pre-roll bar and the later filled one never jump, and so
// the summon dice can be placed above the bar before it has any text. The height is the
// label's own text height plus padding above and below.
let cachedHealthBarHeight: number | null = null;
function healthBarHeight(): number {
	if (cachedHealthBarHeight != null) return cachedHealthBarHeight;

	const probe = new Text({
		text: '0/0',
		style: { fill: 0xffffff, fontSize: 10, fontWeight: '700' },
		resolution: MAX_ZOOM * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
	});
	const textHeight = probe.height > 0 ? probe.height : HP_BAR_HEIGHT;
	probe.destroy();

	cachedHealthBarHeight = textHeight + HP_BAR_PADDING_Y * 2;
	return cachedHealthBarHeight;
}

// World-space gap the HP bar floats above the top of its creature's sprite. Shared
// with hpDiceCenterFor so the summon dice tumble directly over the bar.
const HP_BAR_GAP = 10;

// Duration of a summoned creature's HP-bar fill animation. Shared with the summon's
// floor unfold so the last floor cell finishes materializing exactly as the bar fills.
const HP_BAR_FILL_MS = 300;

// Bar fill color: green while healthy, amber past half, red when low.
function hpColor(ratio: number): number {
	if (ratio > 0.5) return 0x33dd66;
	if (ratio > 0.25) return 0xffcc33;
	return 0xff4444;
}

// Build a floating, empty HP progressbar that doubles as the background of its HP
// text: a full-height background track with a zero-width fill and, initially, no
// numerals (the label starts empty and transparent). The bg/fill Graphics and the
// label are tagged so redrawHealthBar / animateHealthBarFill can find them once the
// HP roll lands. The bar's height is fixed (see healthBarHeight) so it never jumps
// when the text later fades in.
function createHealthBar(): Container {
	const bar = new Container();

	const bg = new Graphics();
	bg.label = 'bg';
	bar.addChild(bg);

	const fill = new Graphics();
	fill.label = 'fill';
	bar.addChild(fill);

	// The bar lives inside the zoomable `camera` container, so a Text baked at the
	// default resolution 1 turns blurry once the board is zoomed in. Rasterize it at
	// the max zoom (times the device pixel ratio) so it stays crisp all the way in.
	// Added last so the numerals render on top of the progressbar backing them; it
	// starts empty and transparent, revealed by the fill animation once the dice land.
	const label = new Text({
		text: '',
		style: { fill: 0xffffff, fontSize: 10, fontWeight: '700' },
		resolution: MAX_ZOOM * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
	});
	label.label = 'label';
	label.anchor.set(0.5, 0.5);
	label.alpha = 0;
	bar.addChild(label);

	overlays.addChild(bar);

	// Draw the empty track (full-height background, no fill) and centre where the
	// numerals will later sit. The bar grows upward from the container origin (y = 0)
	// so it stays above the sprite.
	const height = healthBarHeight();
	bg
		.clear()
		.rect(-HP_BAR_WIDTH / 2, -height, HP_BAR_WIDTH, height)
		.fill({ color: 0x000000, alpha: 0.65 })
		.stroke({ width: 1, color: 0x000000, alpha: 0.9 });
	label.position.set(0, -height / 2);

	return bar;
}

// Repaint an HP bar's background/fill and label for the current HP value (used once
// the bar is live — e.g. combat damage). The fill spans the fixed-height rectangle at
// `ratio` width and the numerals sit centered over it, fully opaque.
function redrawHealthBar(bar: Container, hp: number, maxHp: number) {
	const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

	const height = healthBarHeight();

	const label = bar.getChildByLabel('label') as Text | null;
	if (label) {
		label.text = `${hp}/${maxHp}`;
		label.alpha = 1;
		label.position.set(0, -height / 2);
	}

	const bg = bar.getChildByLabel('bg') as Graphics | null;
	if (bg) {
		bg
			.clear()
			.rect(-HP_BAR_WIDTH / 2, -height, HP_BAR_WIDTH, height)
			.fill({ color: 0x000000, alpha: 0.65 })
			.stroke({ width: 1, color: 0x000000, alpha: 0.9 });
	}

	const fill = bar.getChildByLabel('fill') as Graphics | null;
	if (fill) {
		fill
			.clear()
			.rect(-HP_BAR_WIDTH / 2, -height, HP_BAR_WIDTH * ratio, height)
			.fill(hpColor(ratio));
	}
}

// Animate an HP bar's fill from empty up to `targetHp` over `ms`, easing out, with
// the numeral fading in and counting up alongside it. Used right after a summon's HP
// dice land so the rolled total visibly fills the progressbar (the fill color slides
// red → amber → green through hpColor as it grows) and its text appears in the dice's
// place. Resolves when the fill reaches the target.
function animateHealthBarFill(
	bar: Container,
	targetHp: number,
	maxHp: number,
	ms = 300
): Promise<void> {
	const fill = bar.getChildByLabel('fill') as Graphics | null;
	const label = bar.getChildByLabel('label') as Text | null;
	const height = healthBarHeight();

	return new Promise((resolve) => {
		const start = performance.now();

		const tick = (ticker: Ticker) => {
			void ticker;
			const t = Math.min(1, (performance.now() - start) / ms);
			const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
			const current = targetHp * eased;
			const ratio = maxHp > 0 ? Math.max(0, Math.min(1, current / maxHp)) : 0;

			// The numerals fade in from transparent as the fill grows into the bar.
			if (label) {
				label.text = `${Math.round(current)}/${maxHp}`;
				label.alpha = eased;
			}

			if (fill) {
				fill
					.clear()
					.rect(-HP_BAR_WIDTH / 2, -height, HP_BAR_WIDTH * ratio, height)
					.fill(hpColor(ratio));
			}

			if (t >= 1) {
				app.ticker.remove(tick);
				// Snap to the exact final value so rounding can't leave it a hair short.
				redrawHealthBar(bar, targetHp, maxHp);
				resolve();
			}
		};

		app.ticker.add(tick);
	});
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

// Build the purple cell square for a unit, rendered identically to the cell
// square in the /admin/cards board-preview modal: an axis-aligned square whose
// side equals the drawn (gapped) cell's horizontal diagonal (CELL_WIDTH),
// matching the billboard width, centered on the cell
// center (x = 0) with its bottom edge flush with it (y = 0), so it rises above
// the cell. Its 1-world-unit stroke matches the grid outlines. Lives in `shadows`
// (below the creature sprites) and is anchored to the cell center — never the
// card's x/y offset — so the red image border can be read against it exactly as
// in the preview.
function createCellSquare(x: number, y: number): Graphics {
	const square = new Graphics()
		.rect(-CELL_WIDTH / 2, -CELL_WIDTH, CELL_WIDTH, CELL_WIDTH)
		.stroke({ width: 1, color: 0xa855f7, alignment: 0.5 });

	const { x: isoX, y: isoY } = isoPosOf(x, y);
	square.position.set(isoX, isoY);
	square.eventMode = 'none';

	shadows.addChild(square);

	return square;
}

// Keep a unit's cell square on the cell it currently stands on (mirrors
// positionShadow).
function positionCellSquare(unit: PlacedUnit) {
	const { x: isoX, y: isoY } = isoPosOf(unit.x, unit.y);
	unit.cellSquare.position.set(isoX, isoY);
}

// Float a unit's HP bar just above the top of its sprite. Tracks the sprite's
// actual position (which already carries the card's x/y offset) and its scaled
// height, so the bar stays centered over the creature however it's sized/nudged.
function positionHealthBar(unit: PlacedUnit) {
	unit.healthBar.position.set(
		unit.sprite.x,
		unit.sprite.y - unit.sprite.height * unit.sprite.anchor.y - HP_BAR_GAP
	);
}

// Hover-preview state: ghost billboard + the T-shape floor at 50% opacity.
let previewSprite: Sprite | null = null;
let previewTiles: string[] = [];
// Bumped on every show/clear so a slow async texture load can't revive
// a preview the pointer has already left.
let previewToken = 0;

// A single reusable Text painted with the hovered cell's coordinate (see
// cellLabel), lazily created on first hover and repositioned/retexted as the
// pointer moves between cells. Replaces the fixed row/column edge headers.
let coordLabel: Text | null = null;

// Paint the hovered cell's coordinate on its center. Lives in `overlays` so it
// renders above the floor and any creature standing on the cell.
function showCoordLabel(x: number, y: number) {
	if (!coordLabel) {
		coordLabel = new Text({
			text: '',
			style: { fill: 0x000000, fontSize: 14, fontWeight: '700' },
			// Rasterize at max zoom (times DPR) so it stays crisp when zoomed in, the
			// same treatment the HP-bar labels get inside the zoomable camera.
			resolution: MAX_ZOOM * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
		});
		coordLabel.anchor.set(0.5);
		coordLabel.eventMode = 'none';
		overlays.addChild(coordLabel);
	}

	coordLabel.text = cellLabel(x, y);

	const { x: isoX, y: isoY } = isoPosOf(x, y);
	coordLabel.position.set(isoX, isoY);
	coordLabel.visible = true;
}

// Hide the hover coordinate once the pointer leaves the cell.
function hideCoordLabel() {
	if (coordLabel) coordLabel.visible = false;
}

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

// Tight bounding box of a texture's opaque pixels, in the texture's own
// (unscaled) coordinate space. Billboard art is padded with transparent margins,
// so the visible creature is much smaller than the image; we rasterize the
// texture to an offscreen canvas and scan the alpha channel to find the extent
// of the non-transparent pixels. The result feeds the purple summon frame so it
// hugs the creature instead of the padded image. Cached per texture source since
// the same billboard is reused for every copy of a creature.
const opaqueBoundsCache = new WeakMap<
	object,
	{ x: number; y: number; width: number; height: number }
>();
function opaqueBounds(texture: Texture) {
	const source = texture.source;
	const cached = opaqueBoundsCache.get(source);
	if (cached) return cached;

	// Rasterize at the texture's logical size so the returned bounds are already
	// in the same space the sprite uses (independent of the source's pixel ratio).
	const w = Math.max(1, Math.round(texture.width));
	const h = Math.max(1, Math.round(texture.height));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	ctx.drawImage(source.resource as CanvasImageSource, 0, 0, w, h);
	const { data } = ctx.getImageData(0, 0, w, h);

	const alphaThreshold = 12; // ignore near-invisible antialiasing fringe
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}

	// Fully transparent (shouldn't happen) — fall back to the full texture.
	const bounds =
		maxX < minX
			? { x: 0, y: 0, width: w, height: h }
			: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
	opaqueBoundsCache.set(source, bounds);
	return bounds;
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

	// Both networks fill their floor with the played monster's card-frame texture —
	// the same art GameCard paints behind the card (see textureForType) — so a
	// summoned creature's floor reads as its own card material. Only the cell border
	// differs per side (red for the player, blue for the rival, set by `color` in
	// paintCell).
	const floorTexture = await Assets.load(textureForType(creature.type));

	// Stage 1 — unfold the floor. The played tile is the crossroads of the cross;
	// its new-floor cells are ordered by distance from it so the floor materializes
	// outward from under the monster: the creature's own cell fades in first, then the
	// rest fade in with a slight per-cell delay. Net squares that fall on a cell that
	// already has ground are skipped — the net only ever lays new floor. Occupancy is
	// recorded for every cell up front (keeping board state consistent through the
	// async summon); only the fade is staggered.
	const floorCells = offsets
		.map(([dx, dy]) => ({
			x: gridX + dx,
			y: gridY + dy,
			dist: Math.abs(dx) + Math.abs(dy)
		}))
		.filter((c) => !occupied.has(tileKey(c.x, c.y)))
		.sort((a, b) => a.dist - b.dist);

	for (const c of floorCells) occupied.set(tileKey(c.x, c.y), color);

	// Every cell but the farthest unfolds now, staggered by distance, concurrently
	// with the creature's fade-in and HP roll below.
	const floorFades: Promise<void>[] = [];
	const earlyCells = floorCells.length > 1 ? floorCells.slice(0, -1) : floorCells;
	earlyCells.forEach((c, i) => {
		floorFades.push(
			unfoldFloorCell(c.x, c.y, color, floorTexture, FLOOR_FADE_MS, i * FLOOR_STAGGER_MS)
		);
	});

	// The farthest cell is held back to fade during the HP-bar fill (Stage 4), so the
	// floor finishes unfolding exactly as the bar finishes filling. Null when the net
	// laid only its crossroads.
	const finalFloorCell = floorCells.length > 1 ? floorCells[floorCells.length - 1] : null;

	// Isometric shadow ellipse on the creature's cell, under its sprite.
	const shadow = createShadow(gridX, gridY);

	// Purple cell-reference square on the creature's cell, matching the preview
	// modal. Fixed to the cell center, so the sprite's x/y offset reads against it.
	const cellSquare = createCellSquare(gridX, gridY);

	const sprite = new Sprite(texture);

	// As wide as the drawn (gapped) cell, with the billboard's bottom edge anchored
	// to the cell center (anchor.y = 1), so the image's vertical end sits on the
	// tile. The card's authored size factor (default 1) scales it, matching the
	// board preview in /admin/cards 1:1.
	const scale = CELL_WIDTH / texture.width;
	sprite.scale.set(scale * sizeOf(creature));

	// Billboards carry uneven transparent margins, so the visible creature isn't
	// at the texture's horizontal center. Anchor X on the opaque art's center (a
	// fraction of the texture width) instead of a flat 0.5 so the creature — not
	// the padded image — is centered on its cell. Y stays at 1 to keep its feet on
	// the tile.
	const ob = opaqueBounds(texture);
	const anchorX = (ob.x + ob.width / 2) / texture.width;
	sprite.anchor.set(anchorX, 1);

	// Cell center plus the card's authored x/y offset (default 0), so the billboard
	// sits exactly where the board preview shows it.
	const pos = spritePosOf(creature, gridX, gridY);

	sprite.position.set(pos.x, pos.y);
	// Row-based depth so lower creatures overlap higher ones (see depthFor).
	sprite.zIndex = depthFor(gridX, gridY);

	sprite.eventMode = 'static';
	sprite.cursor = 'pointer';

	// Red frame around the summoned creature, rendered identically to the image
	// border in the /admin/cards board-preview modal so a creature looks on the
	// board exactly as it was calibrated there. It hugs the full texture rectangle
	// (the whole image, transparent margins included), with square corners and no
	// padding. Added as a child of the sprite so it inherits the sprite's scale,
	// position, fade-in alpha, later moves and removal with no extra bookkeeping.
	// Coordinates are in the sprite's unscaled texture space; a pixel (px,py) sits
	// at (px - anchorX*texW, py - texH), so the image's left edge is -anchorX*texW
	// and its top edge is -texH. The stroke is divided by the sprite's *full* scale
	// (base × size factor) so the line stays a constant 1 world unit on screen, the
	// same treatment the modal applies.
	const spriteScale = scale * sizeOf(creature);
	const border = new Graphics();
	border
		.rect(-anchorX * texture.width, -texture.height, texture.width, texture.height)
		.stroke({ width: 1 / spriteScale, color: 0xef4444, alignment: 0.5 });
	border.eventMode = 'none';
	sprite.addChild(border);

	units.addChild(sprite);

	// Stage 2 — fade the creature in now that its floor is painted.
	await fadeIn(sprite);

	// Track the placed unit up front so its (empty) health bar can be shown before the
	// HP roll. hp/maxHp are provisional 0 until the dice land and are set below.
	const unit: PlacedUnit = {
		unitId: ++unitSeq,
		side,
		creature,
		sprite,
		shadow,
		cellSquare,
		x: gridX,
		y: gridY,
		hp: 0,
		maxHp: 0,
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

	// Stage 3 — show the empty (textless) HP bar and roll the creature's HP dice pool
	// over it. Both sides' summons roll their HP dice floating just above the bar so the
	// roll is visible, using the exact same throw and fill animation. The bar fades in at
	// the same time the dice appear, then the roll plays out; the bar carries no HP text
	// yet, only its empty track.
	unit.healthBar = createHealthBar();
	positionHealthBar(unit);

	let rolledHp = 0;
	// Whether the HP dice were shown tumbling above this creature: drives the
	// progressbar fill animation, which plays "once they land".
	const showedHpDice = !!hpDice;
	if (showedHpDice) {
		// Fade the empty bar in alongside the tumbling dice — they appear together, so
		// this fade isn't awaited; it runs while the roll resolves below.
		void fadeIn(unit.healthBar);
		const faces = await rollBoard(
			hpDice,
			creature.hp,
			HP_DICE_COLOR,
			hpDiceCenterFor(sprite, creature.hp)
		);
		rolledHp = faces.reduce((sum, face) => sum + face, 0);
	} else {
		for (let i = 0; i < creature.hp; i++) rolledHp += rollDie(6);
	}

	unit.hp = rolledHp;
	unit.maxHp = rolledHp;

	// Stage 4 — now the roll has landed, fill the bar. For a shown roll the numerals
	// fade in and count up from empty to the rolled total over HP_BAR_FILL_MS while the
	// landed dice stay above it; only once the bar is full do the dice fade out, leaving
	// the bar's HP text as the readout in their place. A silent (no-dice) summon just
	// snaps its full bar in. In step with the fill, the floor's farthest cell unfolds
	// over the same duration so the ground finishes materializing exactly as the bar
	// finishes filling.
	if (finalFloorCell) {
		floorFades.push(
			unfoldFloorCell(
				finalFloorCell.x,
				finalFloorCell.y,
				color,
				floorTexture,
				HP_BAR_FILL_MS,
				0
			)
		);
	}

	if (showedHpDice) {
		await animateHealthBarFill(unit.healthBar, rolledHp, rolledHp, HP_BAR_FILL_MS);
		await hpDice!.fadeOut();
	} else {
		redrawHealthBar(unit.healthBar, rolledHp, rolledHp);
		await fadeIn(unit.healthBar);
	}

	// Make sure every floor panel has finished unfolding before the summon completes.
	await Promise.all(floorFades);

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

// While a hand card is selected for summoning — and through the async summon
// sequence that follows — every creature already on the board is dimmed to 50%
// and made non-interactive (hover + click dropped), the same focus move and
// combat apply. None of the placed units is the one being acted on here (the
// summoned creature isn't on the board yet), so they all dim.
function enterSummonFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 0.5;
	}

	disableUnitInteractivity();
}

// Restore every creature's opacity and interactivity once the summon ends.
function exitSummonFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 1;
	}

	restoreUnitInteractivity();
}

// Drive the summon focus off the selection + summon lifecycle: dim and lock the
// board the moment a card is selected (the tray's "Select" button) and hold it
// through the summon animation, then restore once nothing is selected and the
// summon has finished. Reactive so it tracks every path that sets or clears the
// selection (Select, the committed tile, switching to Unfold) without threading a
// call into each. Move and combat manage their own focus imperatively and never
// change these two signals, so this effect leaves those sequences untouched.
$effect(() => {
	if (selectedMonster || summoning) enterSummonFocus();
	else exitSummonFocus();
});

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

	// Lay a translucent green diamond over each candidate cell rather than
	// repainting the floor tile itself, so the highlight is purely additive: when
	// move mode ends the overlays are dropped and the floor is left untouched.
	for (const key of moveHighlight) {
		const [x, y] = key.split(',').map(Number);
		const { x: isoX, y: isoY } = isoPosOf(x, y);

		const overlay = drawCellDiamond(new Graphics()).fill({
			color: MOVE_TARGET_COLOR,
			alpha: 0.8
		});
		overlay.position.set(isoX, isoY);
		moveOverlay.addChild(overlay);
	}

	// Fade every other creature to 50% (only the unit being moved stays fully
	// opaque) and let clicks fall through the creature sprites so the highlighted
	// destination cells beneath them are actually clickable.
	enterMoveFocus();

	moving = true;
}

// While choosing a move destination, halve the opacity of every creature except
// the one being moved, and let clicks fall through the sprites to the tiles
// beneath so a highlighted destination cell can actually be picked (a sprite
// otherwise sits above its tile and swallows the tap).
function enterMoveFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = unit === movingUnit ? 1 : 0.5;
	}

	// Drop all sprite click handlers so taps fall through to the destination cells.
	disableUnitInteractivity();
}

// Restore every creature's opacity and interactivity once move mode ends.
function exitMoveFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 1;
	}

	restoreUnitInteractivity();
}

// Drop the green move-target overlays, leaving the floor tiles beneath exactly as
// they were (they were never repainted — the highlight was a separate layer).
function restoreMoveHighlight() {
	for (const child of moveOverlay.removeChildren()) child.destroy();

	moveHighlight = [];
}

// Leave move mode without moving.
function cancelMove() {
	restoreMoveHighlight();
	exitMoveFocus();
	moving = false;
	movingUnit = null;
}

// Relocate a unit's sprite (and HP bar) to a new grid cell.
function relocateUnit(unit: PlacedUnit, x: number, y: number) {
	// Cell center plus the card's authored x/y offset, so the unit keeps its
	// preview positioning after moving (mirrors placeMonster).
	const pos = spritePosOf(unit.creature, x, y);
	unit.sprite.position.set(pos.x, pos.y);
	// Refresh row-based depth so the unit re-sorts against others at its new tile.
	unit.sprite.zIndex = depthFor(x, y);

	unit.x = x;
	unit.y = y;

	// Keep the shadow, cell square and HP bar aligned with the sprite's new tile.
	positionShadow(unit);
	positionCellSquare(unit);
	positionHealthBar(unit);
}

// Finish the player's move: relocate the sprite, update the unit's grid position
// and charge the creature's cost to the energy pool.
function completeMove(x: number, y: number) {
	const unit = movingUnit;
	if (!unit) return;

	restoreMoveHighlight();
	exitMoveFocus();

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
	showCombatTargetIcons();

	combating = true;
}

// While choosing a combat target, halve the opacity of every creature except the
// attacker (only it stays fully opaque — the targets fade too, marked instead by
// their full-opacity sword icon), and let clicks fall through the sprites so the
// sword handles beneath them are the ones that get tapped.
function enterCombatFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = unit === attackingUnit ? 1 : 0.5;
	}

	// Drop all sprite click handlers so taps fall through to the sword icons.
	disableUnitInteractivity();
}

// Restore creature opacity and interactivity once combat targeting ends.
function exitCombatFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 1;
	}

	restoreUnitInteractivity();
}

// The size a target's sword icon is scaled to: it fits inside the unit's purple
// cell square (CELL_WIDTH), with a little padding so the blade sits within it.
const COMBAT_ICON_FIT = CELL_WIDTH * 0.9;

// Float the sword icon (the cards' ATK glyph) over each combat target at full
// opacity, fitted to and centered on the target's purple cell square, as the
// clickable handle for striking that target. Tapping the icon resolves the
// attack on its cell — the cell itself is no longer the click target. No-op when
// the sword texture hasn't loaded (the tile click path then remains the fallback).
function showCombatTargetIcons() {
	if (!swordTexture) return;

	for (const key of combatHighlight) {
		const [x, y] = key.split(',').map(Number);
		combatTargetIcons.push(createCombatTargetIcon(x, y));
	}
}

// Build one full-opacity sword icon centered on the purple cell square of the
// target at (x, y): the square spans CELL_WIDTH and rises from the cell center,
// so the icon is centered half a square above it. A dark drop shadow sits behind
// the white blade (mirroring the card's drop-shadow) so it stays legible over any
// billboard. The whole icon is the click target for striking this cell.
function createCombatTargetIcon(x: number, y: number): Container {
	const container = new Container();
	const { x: isoX, y: isoY } = isoPosOf(x, y);
	container.position.set(isoX, isoY - CELL_WIDTH / 2);

	const fit = COMBAT_ICON_FIT / Math.max(swordTexture!.width, swordTexture!.height);

	const shadow = new Sprite(swordTexture!);
	shadow.anchor.set(0.5);
	shadow.scale.set(fit);
	shadow.tint = 0x000000;
	shadow.alpha = 0.6;
	shadow.position.set(1.5, 1.5);
	container.addChild(shadow);

	const blade = new Sprite(swordTexture!);
	blade.anchor.set(0.5);
	blade.scale.set(fit);
	container.addChild(blade);

	container.eventMode = 'static';
	container.cursor = 'pointer';
	container.on('pointertap', () => {
		if (combating && combatHighlight.includes(tileKey(x, y))) resolveCombat(x, y);
	});

	overlays.addChild(container);

	return container;
}

// Tear down the floating sword icons once combat targeting ends.
function clearCombatTargetIcons() {
	for (const icon of combatTargetIcons) icon.destroy({ children: true });
	combatTargetIcons = [];
}

// Repaint the highlighted target tiles back to their real state and drop the
// sword icons floating over them.
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

	clearCombatTargetIcons();

	combatHighlight = [];
}

// Leave combat mode without attacking.
function cancelCombat() {
	restoreCombatHighlight();
	exitCombatFocus();
	combating = false;
	attackingUnit = null;
}

// Rebuild an origin cell's heart counter to match its current life points,
// preserving its layout (vertical stack, or the spread offsets for the blue
// corner origin).
function updateOriginLP(origin: OriginCell) {
	fillHearts(origin.hearts, origin.lp, origin.heartOffsets, origin.heartAnchorY ?? HEART_TIP_Y);
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
	unit.cellSquare.destroy();
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
	if (anchorDice) return rollAnchor(count, COMBAT_DICE_COLOR);
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

	// Drop any lingering player combat marks before the rival acts.
	combatBoxHits = null;

	// Start-of-turn draw: refill the rival's hand from its deck up to HAND_SIZE.
	drawCpuHand();

	try {
		// The rival rolls its own energy now, at the start of its turn, above its blue
		// origin hearts — then spends that pool below.
		await rollRivalEnergy();

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
				// Record it so it shows in the rival's blue plaque (see renderPlaque).
				cpuPlayedCards = [...cpuPlayedCards, move.creature];
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
		previewSprite.alpha = 0.5;
		units.addChild(previewSprite);
	} else {
		previewSprite.texture = texture;
	}

	// Match the placed sprite exactly so the ghost previews where the creature will
	// land: the opaque-centered anchor, plus the selected card's size factor and x/y
	// offset (default 1 / 0). Anchor is re-set each call since the texture can change
	// when the shared ghost sprite is reused for a different card.
	const ob = opaqueBounds(texture);
	const anchorX = (ob.x + ob.width / 2) / texture.width;
	previewSprite.anchor.set(anchorX, 1);

	previewSprite.scale.set((CELL_WIDTH / texture.width) * (selectedMonster ? sizeOf(selectedMonster) : 1));

	const off = selectedMonster ? offsetOf(selectedMonster) : { x: 0, y: 0 };
	const { x: isoX, y: isoY } = isoPosOf(gridX, gridY);
	previewSprite.position.set(isoX + off.x, isoY + off.y);
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

		// Watches the host's CSS box so the renderer's drawing buffer tracks it (see the
		// resize wiring in init); disconnected on teardown.
		let resizeObserver: ResizeObserver | undefined;

		async function init() {
			await app.init({
				// Follow the flex host element so the canvas re-fits whenever the host's
				// box changes (window resize or the right column reflowing).
				resizeTo: host,
				// Keep the canvas's CSS size matched to its drawing buffer so it fills the
				// host exactly instead of overflowing on high-DPR (retina) displays, which
				// is what made it spill behind the right column.
				autoDensity: true,
				resolution: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
				background: '#1b1b1b',
				antialias: true
			});

			host.appendChild(app.canvas);

			camera = new Container();

grid = new Container();
// Render every grid-line outline above every floor tile (see zIndex assignments
// in buildGrid), so painted floor never covers a neighboring cell's lines.
grid.sortableChildren = true;
shadows = new Container();
units = new Container();
// Depth-sort creature sprites by their screen row: a unit lower on the board
// (greater isoY, used as its zIndex) renders above one higher up, so nearer
// creatures correctly overlap farther ones (see depthFor / placeMonster).
units.sortableChildren = true;
overlays = new Container();
// Above every other board layer, so the move-target overlays read as a wash laid
// on top of the floor. No creature ever stands on a candidate cell (see
// moveTargetsFor), so nothing meaningful is hidden by drawing it on top.
moveOverlay = new Container();
moveOverlay.eventMode = 'none';

camera.addChild(grid);
camera.addChild(shadows);
camera.addChild(units);
camera.addChild(overlays);
camera.addChild(moveOverlay);

// The two card plaques, laid flat on the ground plane by their board matrices and
// added above the board layers so their cards read on top of the floor: the player's
// red one at the bottom-right (PLAYER_BOARD_MATRIX), the rival's blue mirror at the
// top-left (RIVAL_BOARD_MATRIX). Both live inside `camera`, so they pan and zoom with
// the board; their contents are drawn by renderPlaque (reactive to each side's
// played-cards list).
playerPlaque.container = new Container();
playerPlaque.container.setFromMatrix(PLAYER_BOARD_MATRIX);
playerPlaque.container.eventMode = 'none';
camera.addChild(playerPlaque.container);

rivalPlaque.container = new Container();
rivalPlaque.container.setFromMatrix(RIVAL_BOARD_MATRIX);
rivalPlaque.container.eventMode = 'none';
camera.addChild(rivalPlaque.container);

// World-space row for the player's hand (upright card PNGs just outside the grid's
// bottom-left edge). Inside `camera` like the two plaques, so it pans and zooms with
// the board; added above them so its cards read on top. Painted by renderHand
// (reactive to `hand`).
handLayer = new Container();
handLayer.eventMode = 'none';
camera.addChild(handLayer);

app.stage.addChild(camera);

// Screen-space layer above the (zoomable) camera for the fixed combat dice, so
// they stay a constant size at the bottom-center of the viewport regardless of zoom.
const diceLayer = new Container();
app.stage.addChild(diceLayer);

// World-space layer inside the camera for the board-bound dice (turn-start energy at
// the origin hearts, HP above a summoned creature), added last so they render on top
// of the board content. Being in the camera, they pan and zoom with the board.
const worldDice = new Container();
camera.addChild(worldDice);

const pixi = { Container, Graphics, Text, Matrix };
anchorDice = new Dice3D({ app, layer: diceLayer, pixi, boxSize: DICE_BOX_SIZE });
playerEnergyDice = new Dice3D({ app, layer: worldDice, pixi, boxSize: DICE_WORLD_SIZE });
rivalEnergyDice = new Dice3D({ app, layer: worldDice, pixi, boxSize: DICE_WORLD_SIZE });
hpDice = new Dice3D({
	app,
	layer: worldDice,
	pixi,
	boxSize: HP_DICE_WORLD_SIZE,
	baseColor: 0xff3344
});

			frameBoard();

			buildGrid();

			// Paint both (empty) plaques now that their containers exist; the $effects on
			// each side's played-cards list repaint them as cards are summoned.
			renderPlaque(playerPlaque, playedCards);
			renderPlaque(rivalPlaque, cpuPlayedCards);

			// Paint the (initially empty) hand row; its $effect repaints it as cards are
			// drawn, summoned, and as the energy pool changes.
			renderHand();

			// Permanently record the pre-painted cells at opposite corners: the red
			// origin at the far corner (cell L12 = last column, last row) and the blue
			// origin at the near corner (cell A1 = first column, first row).
			paintCell(GRID_WIDTH - 1, GRID_HEIGHT - 1, CELL_RED);
			paintCell(0, 0, CELL_BLUE);

			// Load the hearts icon (same one the card renderer uses for HP) so each
			// origin's LP can be drawn as a vertical stack of hearts.
			heartTexture = await Assets.load('/assets/icons/skoll/hearts.svg');

			// Load the broadsword icon (the cards' ATK stat glyph) so it can be floated
			// over each combat target as its clickable attack handle.
			swordTexture = await Assets.load('/assets/icons/lorc/broadsword.svg');

			// Each origin cell starts with 3 life points, shown as a stack of hearts.
			// Kept as destroyable OriginCells so combat can whittle their life down.
			redOrigin = {
				x: GRID_WIDTH - 1,
				y: GRID_HEIGHT - 1,
				side: 'player',
				color: CELL_RED,
				lp: ORIGIN_LP,
				// Spread the red origin's hearts onto the three cells framing the bottom
				// of its corner (13l, 13m, 12m) and hang them downward — the full
				// vertical mirror of the blue origin's upward top-framing hearts.
				heartOffsets: BOTTOM_FRAME_HEART_OFFSETS,
				heartAnchorY: HEART_TOP_Y,
				hearts: drawOriginHearts(
					GRID_WIDTH - 1,
					GRID_HEIGHT - 1,
					ORIGIN_LP,
					BOTTOM_FRAME_HEART_OFFSETS,
					HEART_TOP_Y
				)
			};
			blueOrigin = {
				x: 0,
				y: 0,
				side: 'cpu',
				color: CELL_BLUE,
				lp: ORIGIN_LP,
				// Spread the blue origin's hearts onto the three cells framing the top
				// of its corner (top-left, top, top-right) instead of stacking them.
				heartOffsets: TOP_FRAME_HEART_OFFSETS,
				hearts: drawOriginHearts(0, 0, ORIGIN_LP, TOP_FRAME_HEART_OFFSETS)
			};

			setupControls();

			// Match the renderer's drawing buffer to the host's CSS box, then re-fit the
			// board. `resizeTo: host` only re-measures on a window resize — never when the
			// host's own box changes (its right inset now reserves the right column via
			// --right-col-w) — and its single measurement at init can race layout, leaving
			// the buffer full-window so the board renders behind the column. Observing the
			// host directly resizes the buffer to its real width the moment it settles and
			// on any later box change; the renderer's own 'resize' event re-fits the grid.
			app.renderer.on('resize', () => frameBoard());

			resizeObserver = new ResizeObserver(() => {
				app.renderer.resize(host.clientWidth, host.clientHeight);
			});
			resizeObserver.observe(host);

			// Open the match by rolling the player's energy below their red origin
			// hearts — the same auto-roll that begins each of their later turns. The
			// rival rolls on its own turn (see runCpuTurn), not now.
			rollPlayerEnergy();
		}

		function buildGrid() {
			for (let y = 0; y < GRID_HEIGHT; y++) {
				for (let x = 0; x < GRID_WIDTH; x++) {
					const isoX = (x - y) * (TILE_WIDTH / 2);
					const isoY = (x + y) * (TILE_HEIGHT / 2);

					// Half-extents of the drawn diamond, shrunk by CELL_GAP so tiles are
					// separated by a visible gap. Cell centers stay on the full-size
					// isometric lattice (isoX/isoY), so only the rendered shape shrinks.
					// Shared with paintCell via CELL_HALF_W/H + drawCellDiamond.

					// Always-visible cell outline (no fill) keeps the grid legible. Empty
					// cells show it faintly (50% white); paintCell switches a claimed cell's
					// border to its network color at full opacity. Its higher zIndex keeps the
					// grid lines above every floor tile.
					const outline = new Graphics();
					strokeOutline(outline, EMPTY_BORDER_COLOR, EMPTY_BORDER_ALPHA);
					outline.position.set(isoX, isoY);
					outline.zIndex = 1;
					grid.addChild(outline);
					outlines.set(tileKey(x, y), outline);

					// Interactive fill, empty (transparent) by default; revealed by
					// raising alpha + tinting on hover, preview and placement.
					const tile = new Graphics();
					drawCellDiamond(tile).fill(0xffffff);
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

	// Combat mode: targets are struck by clicking their floating sword icon
	// (see createCombatTargetIcon), not the cell — so a tile tap is swallowed.
	// Only when the sword texture failed to load (no icons) does the cell click
	// stay as a fallback.
	if (combating) {
		if (!swordTexture && combatHighlight.includes(tileKey(x, y))) resolveCombat(x, y);
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

	// Record the played card so it shows in the red "player board" plaque drawn on
	// the canvas (renderPlaque), rendered as its pre-generated PNG.
	playedCards = [...playedCards, monster];

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

	// Paint the cell's coordinate on it while hovered (replaces the edge headers).
	showCoordLabel(x, y);

	if (selectedMonster?.billboard) {
		showPreview(selectedMonster.billboard, x, y);
	} else if (unfolding) {
		showNetPreview(x, y);
	} else if (!occupied.has(tileKey(x, y))) {
		tile.tint = 0xffffff;
		tile.alpha = 0.5;
	}
});

tile.on('pointerout', () => {
	if (hoverTile?.x === x && hoverTile?.y === y) hoverTile = null;

	hideCoordLabel();

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
			resizeObserver?.disconnect();
			app.destroy(true, {
				children: true
			});
		};
	});
</script>

<svelte:head>
	<title>Isometric Grid</title>
</svelte:head>

<!-- The board fills the space below the navbar as a flex row: the game canvas on
     the left shrinks to fit, and the right column (hand + detail) is a real,
     space-occupying DOM column beside it — never overlapping the canvas. -->
<div class="board-layout">
	<!-- Game canvas: flexes to fill the space left of the right column. Its own
	     overlays (left dice panel, combat markers, board plaque) are absolutely
	     positioned within it, so they track the canvas, not the whole window. -->
	<div bind:this={host} class="viewport">
	<!-- The player and rival "board" plaques are now drawn on the canvas itself (Pixi
	     objects laid flat on the isometric ground; see playerPlaque / rivalPlaque /
	     renderPlaque), rendering each summoned card as its pre-generated PNG. -->

	<!-- Combat hit markers: one white result square (black number) per die that scored
	     a hit, stamped over the black combat dice in the on-board anchor box. The box
	     rolls at the canvas's bottom-center (app.screen.width / 2); this overlay lives
	     inside the canvas host, so centering on the host's midline lines up with it. -->
	{#if combatBoxHits && combatBoxHits.length}
		<div
			class="pointer-events-none absolute bottom-6 left-1/2 z-20 flex h-[200px] w-[200px] -translate-x-1/2 flex-wrap content-center items-center justify-center gap-1.5 p-3"
		>
			{#each combatBoxHits as value, i (i)}
				<span
					class="flex h-9 w-9 items-center justify-center rounded-sm border border-base-300 bg-white text-base font-bold text-black shadow-md"
				>
					{value}
				</span>
			{/each}
		</div>
	{/if}

	<!-- Left dice panel: floats over the top-left of the canvas (an absolute overlay
	     inside the canvas host, not a column that reserves space). -->
	<aside
		bind:this={leftPanel}
		class="absolute top-0 left-0 z-10 flex max-h-full flex-col gap-2 overflow-auto p-2"
	>
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
</div>

<!-- Right column: the on-board detail card + the drawn hand grid. Its own
     space-occupying DOM column beside the canvas (not an overlay): a fixed-width
     flex child the canvas shrinks to make room for, scrolling vertically when its
     content overflows. -->
<aside
	class="right-col flex w-[var(--right-col-w)] shrink-0 flex-col gap-2 overflow-y-auto p-2"
>
	<!-- Turn + energy read-out: the shared turn number and both sides' energy pools,
	     shown at the top of the column above the detail card. -->
	<div class="rounded bg-base-100 shadow-sm">
		<DiceRoller {energyPoints} rivalEnergy={cpuEnergy} {turnNumber} {rolling} />
	</div>

	<!-- On-board detail: the last-clicked creature's card and its actions, in a
	     two-column grid above the hand. Always visible: the card slot shows the
	     inspected creature or an empty square placeholder, and the actions sit
	     beside it (disabled until a player unit is inspected). -->
	<div class="grid grid-cols-2 items-start gap-2">
		<!-- Card slot: the inspected creature, or an empty square placeholder holding
		     the layout so the grid never collapses to a full-width prompt. -->
		{#if inspectedCreature}
			<div class="pointer-events-none">
				<GameCard card={inspectedCreature} />
			</div>
		{:else}
			<div
				class="flex aspect-square w-full items-center justify-center rounded border border-dashed border-base-300 bg-base-100/60 p-3 text-center text-xs text-base-content/50"
			>
				Click a creature to inspect it.
			</div>
		{/if}

		<!-- Actions: the inspected unit's Move/Combat (or their in-progress Cancel),
		     with the turn actions pinned beneath them. Full-height so those turn
		     actions align with the foot of the card slot beside it. With nothing
		     inspected the unit actions render disabled so the grid keeps its shape. -->
		<div class="flex h-full flex-col gap-2">
			{#if inspectedCreature && inspectedIsPlayer && moving}
				<button class="btn btn-sm btn-error" onclick={cancelMove}>Cancel Move</button>
			{:else if inspectedCreature && inspectedIsPlayer && combating}
				<button class="btn btn-sm btn-error" onclick={cancelCombat}>Cancel Combat</button>
			{:else}
				<!-- Rival creatures (and the rival's own turn) show the same buttons, all disabled.
				     Also disabled while a summon is landing, or with nothing inspected. -->
				{@const controlsDisabled =
					!inspectedCreature || !inspectedIsPlayer || rivalThinking || summoning}
				<button
					class="btn btn-sm btn-primary justify-between"
					disabled={controlsDisabled ||
						!inspectedCreature ||
						energyPoints < inspectedCreature.cost}
					onclick={startMove}
				>
					<span>Move</span>
					<span class="text-xs opacity-80">
						{#if inspectedCreature}
							Cost {inspectedCreature.cost} · SPD {inspectedCreature.speed}
						{:else}
							—
						{/if}
					</span>
				</button>
				<button
					class="btn btn-sm btn-primary justify-between"
					disabled={controlsDisabled ||
						!inspectedCreature ||
						energyPoints < inspectedCreature.cost ||
						!inspectedCanCombat}
					onclick={startCombat}
				>
					<span>Combat</span>
					<span class="text-xs opacity-80">
						{#if inspectedCreature}
							Cost {inspectedCreature.cost} · ATK {inspectedCreature.atk}d6
						{:else}
							—
						{/if}
					</span>
				</button>
			{/if}

			<!-- Turn actions: pinned to the bottom of the column, under the unit
			     actions and separated by a rule. Unfold extends the network for a
			     fixed cost; End Turn hands control to the rival. -->
			<div class="mt-auto flex flex-col gap-2 border-t border-base-300 pt-2">
				<button
					class={classNames(
						'btn btn-sm w-full gap-1',
						unfolding ? 'btn-secondary' : 'btn-outline'
					)}
					onclick={startUnfold}
					disabled={rivalThinking || rolling || (!unfolding && energyPoints < UNFOLD_COST)}
				>
					{#if unfolding}
						Cancel Unfold
					{:else}
						Unfold ({UNFOLD_COST}
						<span
							class="block h-4 w-4 bg-current [mask-image:url(/assets/icons/sbed/battery-pack.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
							aria-label="Energy"
							title="Energy"
						></span>)
					{/if}
				</button>
				<button
					class="btn btn-outline btn-sm w-full"
					onclick={endTurn}
					disabled={!energyRolled || rolling || rivalThinking}
				>
					{#if rolling}
						<span class="loading loading-spinner loading-xs"></span>
						Rolling…
					{:else}
						End Turn
					{/if}
				</button>
			</div>
		</div>
	</div>

	<div class="divider my-0"></div>

	<!-- Hand header: the drawn hand's count and the remaining draw pile. The deck is
	     shown as a count only — its cards are drawn into the hand at each turn start,
	     not listed here. -->
	<div class="flex items-center justify-between px-1">
		<span class="text-xs font-semibold tracking-wide uppercase opacity-60">
			Hand ({hand.length}/{HAND_SIZE})
		</span>
		<span class="badge badge-neutral badge-sm gap-1">Deck: {deck.length}</span>
	</div>

	<!-- Sort controls: one cell per creature attribute. The active sort column is
	     highlighted; clicking cycles asc → desc → off (see toggleSort). -->
	<div class="grid grid-cols-5 gap-1">
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
			<!-- Clicking anywhere on the card loads it into the detail panel above
			     (inspect-only for hand cards); the Select overlay still summons it. -->
			<div
				class={classNames('group relative cursor-pointer transition', {
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
				<GeneratedCardImage id={card.id} name={card.name} />
				<!-- Darkening layer + Select button covering the whole card, hidden until
				     the card is hovered, then fading in together (the same overlay GameCard
				     used to provide). -->
				<div
					class="absolute inset-0 z-20 bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
				></div>
				<div
					class="absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100"
				>
					<button
						class="btn btn-sm btn-primary"
						disabled={summoning || moving || combating || !canSummon(card)}
						onclick={() => (selectedMonster = card)}
					>
						{selectedMonster?.id === card.id ? 'Selected' : 'Select'}
					</button>
				</div>
			</div>
		{/each}

		{#if !handCards.length}
			<div
				class="col-span-2 flex items-center justify-center rounded border border-dashed border-base-300 bg-base-100/60 p-4 text-center text-sm text-base-content/60"
			>
				{deck.length ? 'Cards will be drawn at the start of your turn.' : 'Your deck is empty.'}
			</div>
		{/if}
	</div>
</aside>
</div>

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
		/* Height of the app navbar (DaisyUI .navbar default). The board row is offset
		   by this so the canvas and the right column sit below it, not under it. */
		--navbar-h: 4rem;
		/* Width of the right column (hand + detail). It's a real flex column of this
		   width; the canvas takes whatever horizontal space is left. */
		--right-col-w: 400px;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #1b1b1b;
	}

	/* The board is a flex row filling the space below the navbar: the canvas on the
	   left and the right column beside it. Being a real flex row, the two never
	   overlap — the column occupies its own horizontal space and the canvas gets the
	   remainder. */
	.board-layout {
		position: fixed;
		inset: var(--navbar-h) 0 0 0;
		display: flex;
		align-items: stretch;
	}

	/* The game canvas host: flexes to fill the space left of the right column and
	   shrinks with it. min-width:0 lets the flex item shrink below the canvas's
	   intrinsic size (so the canvas follows the box instead of forcing it wide);
	   overflow:hidden clips any transient over-paint so nothing bleeds past the edge.
	   The left dice panel floats over it as an absolute overlay. */
	.viewport {
		position: relative;
		flex: 1 1 auto;
		min-width: 0;
		height: 100%;
		overflow: hidden;
	}

	/* The canvas Pixi appends fills its host exactly (autoDensity keeps the CSS box
	   matched to the drawing buffer, so it never overflows on high-DPR displays). */
	.viewport :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* The right column: its own fixed-width, full-height flex child beside the
	   canvas. */
	.right-col {
		flex: 0 0 var(--right-col-w);
		height: 100%;
	}
</style>