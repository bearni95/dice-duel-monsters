// The board match's game engine and PixiJS renderer, extracted out of the board
// route so the page component is left as a thin shell that only wires this engine
// to the DOM. It owns the isometric grid, the summon / move / combat rules, the
// CPU rival AI, the on-board 3D dice and the card plaques — all the imperative
// Pixi state — and exposes the reactive slices the sidebar UI reads (energy, hand,
// the inspected unit, combat/game-over results) as getters plus the player's
// commands (summon selection, move, combat, unfold, end turn) as methods.
//
// Built as a factory returning a plain object of getters + methods (rather than a
// class) so the game logic below keeps its original free-function form — no `this`
// threading — while each reactive `$state` local is surfaced to the component
// through a getter. Lives in a `.svelte.ts` module so it can use Svelte 5 runes;
// `createBoardEngine()` must be called during a component's initialisation so its
// `$state`/`$derived`/`$effect` are owned (and torn down) by that component.
import { tick } from 'svelte';
import {
	Application,
	Assets,
	ColorMatrixFilter,
	Container,
	Graphics,
	Matrix,
	Sprite,
	Text,
	Texture,
	Ticker
} from 'pixi.js';
import type { IGameCreature } from '$adapters/creature.adapter';
import { CardApiAdapter } from '$adapters/cardApi.adapter';
import { getDeckById, getPlayerDeck, getCpuDeck } from '$services/deck.service';
import { playerDeckService } from '$services/player-deck.service';
import { playerDeckAdapter } from '$adapters/player-deck.adapter';
import { enabledCardIds, forcedCardIds } from '$utils/deck/enabledCardIds';
import { textureForType } from '$utils/card/typeTexture';
import rollDie from '$utils/dice/rollDie';
import { Dice3D } from '$utils/dice/dice3d';
import { buildStaticDie, orderedDieFaces, FACE_SRC_BASE } from '$utils/dice/staticDie';
import { shuffle } from '$utils/board/shuffle';
import { cellLabel } from '$utils/board/coords';
import { DICE_NETS, NEIGHBOR_OFFSETS, offsetsForRotation } from '$utils/board/diceNet';
import { pSingleDie, pAnyDie } from '$utils/board/cpuScoring';
import { opaqueBounds } from '$utils/board/opaqueBounds';
import type {
	Side,
	PlacedUnit,
	OriginCell,
	CpuMove,
	CardPlaque,
	SortKey,
	UnitAction
} from '$types/board.type';
import { diceAdapter } from '$adapters/dice.adapter';
import {
	emptyEnergyPools,
	type DiceRole,
	type DiceTemplateConfig,
	type EnergyPools,
	type SpawnedDie
} from '$types/dice.type';

export function createBoardEngine() {

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
	let leftPanel: HTMLElement | undefined;

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
	// The id of the player unit whose on-board Move / Combat buttons are currently
	// unfolded beneath it — set while the pointer hovers the creature (or the buttons
	// themselves), cleared when it leaves both, and forced to the acting unit while a
	// move / combat is in flight. Stored as an id (not the PlacedUnit) so it can be
	// reactive without wrapping the unit's live Pixi objects in a proxy; the unit is
	// looked up from placedUnits when the buttons repaint (see renderUnitActions).
	let hoveredActionUnitId = $state<number | null>(null);
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

	// The player's energy, split into one pool per die role. Each turn-start dice
	// roll banks each landed face's value into the pool matching that face's role;
	// each action then spends its own pool (summoning from `summon`, moving from
	// `move`, attacking from `attack`) rather than a shared total. The player's pools
	// accumulate across turns (the rival's reset each of its own turns — see
	// rollRivalEnergy). Deep `$state` so mutating a single pool stays reactive.
	let energy = $state<EnergyPools>(emptyEnergyPools());

	// The dice template config, loaded on mount, and `iconRoleMap`, the cached
	// icon→role lookup used to score each landed face.
	let diceConfig = $state<DiceTemplateConfig | null>(null);
	let iconRoleMap: Map<string, DiceRole> | null = null;

	// The role face icons (the same summon / move / attack glyphs the energy counters
	// beside each dice pool show), cached once the dice config loads so a creature's
	// on-board Move / Combat buttons can print each action's cost beside its element
	// icon. Kept in a plain map — Textures must not be wrapped in a $state proxy — with
	// `roleIconsReady` bumped when they land so the action-button $effect repaints.
	const roleIconTex: Partial<Record<DiceRole, Texture | null>> = {};
	let roleIconsReady = $state(0);
	async function loadRoleIcons(cfg: DiceTemplateConfig) {
		await Promise.all(
			(['summon', 'move', 'attack'] as DiceRole[]).map(async (role) => {
				const url = cfg.roles[role]?.icon;
				roleIconTex[role] = url ? await Assets.load<Texture>(url).catch(() => null) : null;
			})
		);
		roleIconsReady++;
	}

	// Each side's remaining match dice. Both players start the match with the full
	// dice matrix — one copy of every die the game can produce (spawnAll) — seeded the
	// moment the template config lands (see seedMatchDice). Each turn-start roll draws
	// (up to) three dice from the rolling side's own pool and *consumes* them, so a die
	// can only be rolled once per match. Once a side's pool is empty it stops rolling
	// and instead banks a flat +1 to every energy pool each turn (see the no-dice path
	// in beginPlayerDicePhase / rollRivalEnergy). `$state` so the picker's read-out and
	// the pick count track consumption live.
	let playerDice = $state<SpawnedDie[]>([]);
	let rivalDice = $state<SpawnedDie[]>([]);

	// The player's just-rolled turn-start dice: the cubes they picked, moved out to the roll
	// spot past the block where they tumbled, and kept parked there (as plain static cubes)
	// until the turn ends. Populated by rollPickedDice once the roll animation settles and
	// cleared in endTurn. This is what replaced the old 3D energy roller for the player —
	// the dice now roll in the 2D isometric board and stay put for the turn.
	let rolledTurnDice = $state<SpawnedDie[]>([]);

	// The rival's just-rolled turn-start dice: the mirror of `rolledTurnDice` for the CPU. The
	// rival's block now sits at the opposite end of the grid and rolls in the same 2D isometric
	// way (see rollRivalEnergy) — the picked cubes sink, re-emerge and tumble at the rival's roll
	// spot, then park there. Populated when the rival rolls on its turn and cleared when that turn
	// ends (see runCpuTurn), exactly as the player's parked dice clear in endTurn.
	let rivalRolledTurnDice = $state<SpawnedDie[]>([]);

	// Fixed grid slot (0-based) each match die occupies, and the slot count of a full
	// pool — both captured once at seed time (see seedMatchDice). The dice display draws
	// every die at its slot against this total, so consumed dice leave their slot empty
	// and the survivors never reflow.
	let diceSlotById = new Map<string, number>();
	let diceSlotCount = 0;

	// The player's turn-start dice-pick phase: while true the board waits for the
	// player to choose (up to) three of their owned dice to roll for energy; the DOM
	// picker overlay reads `dicePool` / `dicePickCount` and calls `confirmDicePick`.
	let pickingDice = $state(false);

	// The ids of the player's dice currently selected in the on-canvas turn-start
	// picker (the little 3D dice laid past the red plaque). Seeded when the pick phase
	// opens (see beginPlayerDicePhase) and cleared once the roll consumes them. Each
	// spawned die id is unique in the pool, so a plain id list is enough to track the
	// chosen dice. `$state` so the display re-highlights as the player toggles them.
	let dicePick = $state<string[]>([]);

	// True while a player summon is playing out: from the moment the tile is
	// clicked through the floor paint, sprite fade-in, HP dice roll and health-bar
	// reveal. The right-side column's buttons (tray Select actions and the inspect
	// panel's Move/Combat/Effect) are disabled for this window so a second card
	// can't be summoned before the current one lands with its rolled HP.
	let summoning = $state(false);

	// Special (Fusion / Ritual) summon flow. Fusion and Ritual monsters are drawn
	// into the hand like any card, but instead of paying energy and unfolding a
	// dice net they are summoned by sacrificing creatures already on the board and
	// then placed onto an existing tile of the player's color (no net, no energy).
	//
	// The flow runs in two phases: `materials` (the player clicks their own on-board
	// creatures to pick the sacrifices) then `placing` (the materials are destroyed
	// and the player clicks a red tile to drop the special monster). `specialCard`
	// holds the card through both phases; `specialMaterials` holds the chosen
	// sacrifices (plain array — it wraps live Pixi objects that must not be proxied).
	let specialCard = $state<IGameCreature | null>(null);
	let specialPhase = $state<'materials' | 'placing' | null>(null);
	let specialMaterials: PlacedUnit[] = [];
	// Reactive mirrors driving the buttons/prompt: whether the current selection
	// satisfies the summon condition, and the human-readable instruction shown in
	// the on-canvas action column.
	let specialReady = $state(false);
	let specialPrompt = $state('');

	// Shared turn counter for the summon-cost ramp. Both players share a turn
	// number: the player acts, then the rival acts on the same turn, then the
	// number advances.
	let turnNumber = $state(1);

	// The board's own 3D dice, rendered directly on the game canvas. `anchorDice`
	// lives in screen space at a fixed spot (bottom-center) for the player's combat
	// rolls; the rest live inside the camera (world space), so they pan and zoom with
	// the board. Both sides' turn-start energy rolls now tumble as flat isometric cubes
	// at each block's roll spot (see rollPickedDice / rollRivalEnergy), so `playerEnergyDice`
	// survives only as the reference box the energy-roll layout math sizes against
	// (diceHalfExtent); `hpDice` still floats a 3D throw above a freshly summoned creature.
	let anchorDice: Dice3D | undefined;
	let playerEnergyDice: Dice3D | undefined;
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

	// Neutral body colour behind the static grid dice, shared by both sides. The baked
	// face PNGs already carry their own coloured borders, so the cube backing stays a dark
	// neutral (just filling seams / any transparent margin) rather than tinting each side
	// red or blue, which would frame every face in a second, unwanted border.
	const STATIC_DIE_BODY_COLOR = '#2b2b2b';

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

	// Order a freshly spawned pool so its rows read in the same role order as the energy
	// counters beside the block (ENERGY_ROWS: summon, then move, then attack). spawnAll emits
	// each template's six rarities contiguously — exactly one row of MATCH_DIE_COLS — and every
	// die in that run shares the template's role, so a stable sort by role rank keeps each row
	// intact while floating the summon rows nearest the grid and sinking the attack rows furthest
	// out, matching the counters' summon→attack stacking.
	function sortDiceByRole(dice: SpawnedDie[]): SpawnedDie[] {
		const rank = new Map(ENERGY_ROWS.map(({ role }, i) => [role, i]));
		return [...dice].sort((a, b) => (rank.get(a.role) ?? 0) - (rank.get(b.role) ?? 0));
	}

	// Seed both sides' match dice pools with the full dice matrix — one copy of every
	// die the game can produce (each template crossed with every rarity). Called once
	// the template config lands; a no-op until then. Each side gets its own independent
	// copy, which its turn-start rolls then draw from and consume over the match.
	function seedMatchDice() {
		if (!diceConfig) return;
		playerDice = sortDiceByRole(diceAdapter.spawnAll(diceConfig));
		rivalDice = sortDiceByRole(diceAdapter.spawnAll(diceConfig));
		// Pin each die to a fixed grid slot for the whole match. Both sides seed the same
		// full matrix in the same order, so one id→slot map serves both. The dice display
		// lays each die out by its slot (against this fixed total) instead of its live array
		// index, so a die rolled and consumed leaves its slot empty rather than letting the
		// survivors slide up to close the gap.
		diceSlotById = new Map(playerDice.map((d, i) => [d.id, i]));
		diceSlotCount = playerDice.length;
	}

	// Remove the given dice (matched by id, one occurrence per entry) from a match
	// pool, returning the remaining dice. Used to consume the dice a side just rolled
	// so each die can only be rolled once per match.
	function consumeDice(pool: SpawnedDie[], used: SpawnedDie[]): SpawnedDie[] {
		const remaining = [...pool];
		for (const die of used) {
			const idx = remaining.findIndex((d) => d.id === die.id);
			if (idx !== -1) remaining.splice(idx, 1);
		}
		return remaining;
	}

	// The flat energy a side banks on a turn when it has run out of dice to roll: +1
	// to each pool (summon / move / attack), added in place so the read-out tracks it.
	function bankNoDiceBonus(pool: EnergyPools) {
		pool.summon += 1;
		pool.move += 1;
		pool.attack += 1;
	}

	// The player's remaining match dice — the pool their turn-start pick draws from and
	// consumes. Empty once every die has been spent (then the flat +1 bonus applies).
	function dicePool(): SpawnedDie[] {
		return playerDice;
	}

	// How many dice a turn-start roll uses: three, or fewer when the pool is smaller.
	function dicePickCount(): number {
		return Math.min(3, playerDice.length);
	}

	// Open the player's turn-start dice-pick phase (the opening roll and every later
	// player turn). With a genuine choice — more dice left than the roll uses — the DOM
	// picker is shown; otherwise the few remaining dice are rolled straight away. Once
	// the player has no dice left, the flat no-dice bonus (+1 to each pool) is banked
	// instead of a roll. Guarded so it only happens once per turn.
	async function beginPlayerDicePhase() {
		if (energyRolled || rolling || pickingDice) return;

		// The energy roll drops any lingering combat marks.
		combatBoxHits = null;

		if (!diceConfig) return; // template config not loaded yet — retried on next tick

		// Out of dice: bank the flat +1-to-each-pool bonus instead of rolling.
		if (playerDice.length === 0) {
			bankNoDiceBonus(energy);
			energyRolled = true;
			return;
		}

		if (playerDice.length > dicePickCount()) {
			// Open the on-canvas picker with the full grid and nothing chosen yet: each die
			// the player clicks leaves the grid for the roller until pickCount are picked.
			dicePick = [];
			pickingDice = true;
			return;
		}
		await rollPickedDice(playerDice);
	}

	// Toggle one of the player's dice in the on-canvas turn-start pick: deselect it if
	// already chosen, otherwise select it while the pick still has room (up to the roll's
	// pickCount). Inert outside the pick phase or once a throw is under way.
	function toggleDicePick(id: string) {
		if (!pickingDice || rolling) return;
		if (dicePick.includes(id)) {
			dicePick = dicePick.filter((d) => d !== id);
		} else if (dicePick.length < dicePickCount()) {
			dicePick = [...dicePick, id];
		}
	}

	// Roll the dice the player selected on the canvas. Resolves the chosen ids back to
	// their dice (in pool order) and hands them to the shared pick roller. Requires a
	// full selection (exactly pickCount), matching the Roll button's enabled state.
	async function rollDicePick() {
		if (!pickingDice || rolling) return;
		if (dicePick.length !== dicePickCount()) return;
		const chosen = playerDice.filter((d) => dicePick.includes(d.id));
		await rollPickedDice(chosen);
	}

	// Send the picked dice under the board and bring them back up at the roll spot, then roll them
	// there: a three-beat move where each cube first loses height and sinks straight down through
	// the board until it fades from view, then re-emerges rising up into its roll-spot seat, and
	// finally — once every cube has surfaced — tumbles on the spot in unison (a quick spin that
	// eases to a stop over a couple of decaying hops), coming to rest exactly where
	// renderDiceDisplay will redraw it as a parked cube. Reads the given `nodeById` map (the
	// player's or the rival's) as it stands right now, so it must run before any state change
	// repaints (and destroys) the layer, and lays the seats out along the given side's `axes`.
	function animateDiceRollToSpot(
		picked: SpawnedDie[],
		nodeById: Map<string, Container>,
		axes: { uHat: { x: number; y: number }; vHat: { x: number; y: number }; mid: { x: number; y: number } }
	): Promise<void> {
		// Pair each picked cube with the offset from its current slot to its roll-spot seat, and
		// hide its selection ring (a sibling in the wrap) so only the cube itself travels.
		const items = picked
			.map((die, i) => {
				const cube = nodeById.get(die.id);
				const wrap = cube?.parent;
				if (!cube || !wrap) return null;
				for (const sibling of wrap.children) if (sibling !== cube) sibling.visible = false;
				const seat = rolledDieCenter(i, picked.length, axes);
				return { cube, base: { x: seat.x - wrap.x, y: seat.y - wrap.y } };
			})
			.filter((it): it is { cube: Container; base: { x: number; y: number } } => it !== null);
		if (items.length === 0) return Promise.resolve();

		const sinkMs = 340; // beat one: drop straight down through the board and fade out
		const emergeMs = 360; // beat two: rise back up into view at the roll-spot seat
		const rollMs = 620; // beat three: tumble on the spot
		const spins = 2; // full turns the cube spins through as it rolls
		const hops = 3; // vertical bounces, amplitude decaying to a flat landing
		const hopAmp = MATCH_DIE_SIZE * 0.55;
		const depth = MATCH_DIE_SIZE * 1.5; // how far below the board a cube sinks before it vanishes

		return new Promise((resolve) => {
			const start = performance.now();
			const tick = (ticker: Ticker) => {
				void ticker;
				const now = performance.now() - start;
				for (const { cube, base } of items) {
					cube.rotation = 0;
					cube.scale.set(1, 1);
					if (now < sinkMs) {
						// Sink straight down from the grid slot, fading out as it slips under the board.
						const st = now / sinkMs;
						const ease = st * st; // easeInQuad: accelerate downward
						cube.position.set(0, depth * ease);
						cube.alpha = 1 - ease;
					} else if (now < sinkMs + emergeMs) {
						// Surface at the seat (x jumps over while invisible), rising up as it fades in.
						const et = (now - sinkMs) / emergeMs;
						const ease = 1 - Math.pow(1 - et, 2); // easeOutQuad: decelerate into the seat
						cube.position.set(base.x, base.y + depth * (1 - ease));
						cube.alpha = ease;
					} else {
						// Tumble on the seat: spin eases to a stop over decaying hops and a squash.
						const rt = Math.min(1, (now - sinkMs - emergeMs) / rollMs);
						const eo = 1 - Math.pow(1 - rt, 3);
						const bounce = Math.abs(Math.sin(hops * Math.PI * rt)) * hopAmp * (1 - rt);
						const squash = 1 + 0.1 * Math.sin(hops * Math.PI * 2 * rt) * (1 - rt);
						cube.alpha = 1;
						cube.position.set(base.x, base.y - bounce);
						cube.rotation = spins * Math.PI * 2 * eo;
						cube.scale.set(squash, squash);
					}
				}
				if (now >= sinkMs + emergeMs + rollMs) {
					for (const { cube, base } of items) {
						cube.position.set(base.x, base.y);
						cube.rotation = 0;
						cube.scale.set(1, 1);
						cube.alpha = 1;
					}
					app.ticker.remove(tick);
					resolve();
				}
			};
			app.ticker.add(tick);
		});
	}

	// Bank the energy for a set of rolled dice with a plain RNG (no 3D roller): each die lands
	// a random face and its value feeds the pool under the role that face carries. Mirrors the
	// scoring rollEnergyDice does for the rival, minus the on-board 3D throw.
	function bankPickedEnergy(dice: SpawnedDie[], pool: EnergyPools) {
		if (!diceConfig) return;
		const map = (iconRoleMap ??= diceAdapter.roleByIcon(diceConfig));
		for (const die of dice) {
			const face = rollDie(6);
			const scored = diceAdapter.faceEnergy(diceConfig, die, face, map);
			if (scored) pool[scored.role] += scored.value;
		}
	}

	// Roll the dice the player chose (or the whole pool when there was no choice). The picked
	// cubes sink under the board and re-emerge at the roll spot past the block, then tumble there
	// in the 2D isometric board (no 3D roller), then stay parked at that spot until the turn ends;
	// their energy is banked from the roll and the dice are consumed from the player's match pool.
	async function rollPickedDice(dice: SpawnedDie[]) {
		if (rolling) return;
		const picked = dice.slice(0, 3);
		// Play the move-and-roll on the live cube nodes. Lock the board for it and hold off the
		// pick-phase teardown / pool consumption until it finishes, so the cubes survive the
		// animation instead of being destroyed by an early repaint.
		rolling = true;
		try {
			await animateDiceRollToSpot(picked, diceNodeById, playerDiceAxes());
		} finally {
			rolling = false;
		}
		pickingDice = false;
		dicePick = [];
		// Pull the picked dice out of the pool (their grid slots go empty) and park them at the
		// roll spot as `rolledTurnDice`, where renderDiceDisplay redraws them exactly where the
		// animation left them — kept there until endTurn clears them.
		playerDice = consumeDice(playerDice, picked);
		rolledTurnDice = picked;
		bankPickedEnergy(picked, energy);
		energyRolled = true;
	}

	// The player confirms their turn-start pick from the DOM overlay. Ignores picks
	// outside the pick phase or once a throw is under way.
	async function confirmDicePick(dice: SpawnedDie[]) {
		if (!pickingDice || rolling) return;
		await rollPickedDice(dice);
	}

	// Roll the rival's energy from (up to) three dice drawn at random — without replacement — out
	// of its own remaining match pool, then consume them. The rival's pools reset each of its own
	// turns, then fill from this roll. Once the rival is out of dice it banks the flat +1-to-each-
	// pool no-dice bonus instead of rolling.
	//
	// The rival rolls exactly the way the player does now: the picked cubes sink under the board
	// and re-emerge tumbling at the rival's own roll spot (past its block at the opposite end of
	// the grid), then park there as `rivalRolledTurnDice` — the mirror of the player's
	// rollPickedDice, minus the on-canvas picker (the rival auto-picks its dice).
	async function rollRivalEnergy() {
		cpuEnergy.summon = 0;
		cpuEnergy.move = 0;
		cpuEnergy.attack = 0;

		if (rivalDice.length === 0) {
			bankNoDiceBonus(cpuEnergy);
			return;
		}

		// Auto-pick (up to) three dice at random from the rival's own pool. From here it rolls
		// like the player: no choice UI, but the same sink / re-emerge / tumble on the board.
		const picked = shuffle([...rivalDice]).slice(0, Math.min(3, rivalDice.length));

		// Flush the pending reactive repaint (the cpuEnergy reset above marked it dirty), then do
		// one explicit render so `rivalDiceNodeById` holds live nodes for the picked cubes. The
		// render token guard makes this final render win over the effect's, so the cubes survive
		// into the animation; no tracked state changes during it, so nothing repaints mid-tumble.
		await tick();
		await renderDiceDisplay();

		rolling = true;
		try {
			await animateDiceRollToSpot(picked, rivalDiceNodeById, rivalDiceAxes());
		} finally {
			rolling = false;
		}

		// Pull the rolled dice from the pool (their grid slots go empty), park them at the rival's
		// roll spot, and bank their energy into cpuEnergy — the mirror of rollPickedDice.
		rivalDice = consumeDice(rivalDice, picked);
		rivalRolledTurnDice = picked;
		bankPickedEnergy(picked, cpuEnergy);
	}

	// End the player's turn: clear the combat dice, hand control to the rival (which
	// rolls and spends its own energy on its turn), then open the player's turn-start
	// dice pick for their next turn. Driven by the panel's End Turn button.
	async function endTurn() {
		if (rolling || rivalThinking || specialPhase || pickingDice) return;

		anchorDice?.clear();
		energyRolled = false;
		combatBoxHits = null;
		// Clear the parked roll-spot dice — they only live for the turn that rolled them.
		rolledTurnDice = [];

		await runCpuTurn();
		await beginPlayerDicePhase();
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
	// $state so the on-canvas rival hand (rendered as face-down card backs, see renderCpuHand)
	// repaints as the rival draws and summons — the mirror of the player's reactive `hand`.
	let cpuHand = $state<IGameCreature[]>([]);

	// Refill the rival's hand from the top of its deck to HAND_SIZE at the start of
	// each rival turn (the mirror of the player's drawPlayerHand).
	function drawCpuHand() {
		while (cpuHand.length < HAND_SIZE && cpuDeck.length) {
			const [next, ...rest] = cpuDeck;
			cpuDeck = rest;
			cpuHand = [...cpuHand, next];
		}
	}
	// Reactive so the rival's remaining energy stays in sync with the role counters beside
	// its dice pool (see renderDiceDisplay) and updates live as the CPU spends it during its
	// turn. Split into the same three role pools as the player's; reset each rival turn.
	let cpuEnergy = $state<EnergyPools>(emptyEnergyPools());
	let rivalThinking = $state(false);

	const cpuAdapter = new CardApiAdapter();

	// Fusion / Ritual monsters are "special summon" cards: they aren't summoned by
	// paying energy and unfolding a net, but by sacrificing on-board creatures.
	// Detected from the card type (see the /admin catalog rules).
	function isFusion(card: IGameCreature): boolean {
		return (card.type ?? '').includes('Fusion');
	}
	function isRitual(card: IGameCreature): boolean {
		return (card.type ?? '').includes('Ritual');
	}
	function isSpecialSummon(card: IGameCreature): boolean {
		return isFusion(card) || isRitual(card);
	}

	// The creatures a side currently has on the board.
	function unitsOf(side: Side): PlacedUnit[] {
		return [...placedUnits.values()].filter((u) => u.side === side);
	}

	// Whether a placed unit can serve as a sacrifice for the given special summon.
	// A Fusion needs one creature matching its attribute and a *different* one
	// matching its monster type (race), so only creatures matching either count. A
	// Ritual is paid in total cost, so any creature qualifies.
	function eligibleMaterial(card: IGameCreature, unit: PlacedUnit): boolean {
		if (isFusion(card)) {
			return unit.creature.attribute === card.attribute || unit.creature.race === card.race;
		}
		return true;
	}

	// Whether a chosen set of sacrifices satisfies the special summon condition.
	// Fusion: exactly two distinct creatures filling the attribute and monster-type
	// roles. Ritual: the sacrifices' total cost meets or exceeds the ritual's cost.
	function materialsSatisfy(card: IGameCreature, mats: PlacedUnit[]): boolean {
		if (isFusion(card)) {
			if (mats.length !== 2) return false;
			const [a, b] = mats;
			const fills =
				(a.creature.attribute === card.attribute && b.creature.race === card.race) ||
				(b.creature.attribute === card.attribute && a.creature.race === card.race);
			return fills;
		}
		return mats.reduce((sum, u) => sum + u.creature.cost, 0) >= card.cost;
	}

	// Whether the player currently has the on-board creatures needed to special
	// summon this card — the material-based analogue of the energy check below.
	function canSpecialSummon(card: IGameCreature): boolean {
		const mine = unitsOf('player');
		if (isFusion(card)) {
			const attrUnits = mine.filter((u) => u.creature.attribute === card.attribute);
			const typeUnits = mine.filter((u) => u.creature.race === card.race);
			return attrUnits.some((a) => typeUnits.some((t) => t !== a));
		}
		return mine.reduce((sum, u) => sum + u.creature.cost, 0) >= card.cost;
	}

	// A card can be summoned when the player can pay for it: Fusion / Ritual cards
	// need the required sacrifices on the board; every other card needs the energy.
	function canSummon(card: IGameCreature): boolean {
		if (isSpecialSummon(card)) return canSpecialSummon(card);
		return card.cost <= energy.summon;
	}

	// Flag a hand card for summoning — the player then picks a tile to place it on.
	// Driven by both the DOM hand tiles' Select button and the on-canvas hand cards'
	// summon button. Fusion / Ritual cards divert into the material-sacrifice flow
	// instead of the net-placement one.
	function selectMonster(card: IGameCreature) {
		// A staged special summon owns the board until it resolves or cancels.
		if (specialPhase) return;
		if (isSpecialSummon(card)) {
			beginSpecialSummon(card);
			return;
		}
		selectedMonster = card;
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

	// The card ids the signed-in player's own deck contributes to the draw pile:
	// the deck they built on /decks and enabled there (a lone deck counts as
	// enabled — see playerDeckAdapter.activeDeck). Empty when nobody is signed in,
	// when Supabase isn't configured for this build, or when no deck is enabled,
	// which is what hands the draw pile back to the curated decks below.
	//
	// Waits for the decks to actually load: the board mounts while the session is
	// still resolving, so reading them without waiting would find nothing every
	// time and silently play someone else's deck.
	//
	// One id per *distinct* card, not one per copy. Copies are dropped on purpose:
	// the engine identifies a hand card by its card id (summoning discards every
	// entry sharing that id), so a draw pile holding three of a card would lose
	// two of them the moment the first is played. The curated decks are already
	// dealt this way — `loadByIds` folds their duplicate main-deck entries into
	// one — so this keeps both sides drawing under the same rule.
	async function playerAccountCardIds(): Promise<number[]> {
		const { decks } = await playerDeckService.ready();
		const active = playerDeckAdapter.activeDeck(decks);
		return active ? active.cards.map((card) => card.cardId) : [];
	}

	// Resolve card ids into the player's draw pile and deal the opening hand.
	// Playable, placeable (billboard) monsters only, so a card that can't be
	// summoned never takes up a slot in hand; `forcedIds` keeps cards a curated
	// deck turned on despite being flagged not playable.
	async function loadPlayerCards(cardIds: number[], forcedIds: number[] = []) {
		loading = true;

		try {
			await cardApiAdapter.loadByIds(cardIds, true, forcedIds);
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

	// Deal the player's hand from their own enabled deck. When they haven't got
	// one, fall back to the curated deck chosen for this match (via the `?player=`
	// query param, then the last board selection), and to a random monster pull
	// when there's no deck at all.
	async function loadDeck() {
		const accountCardIds = await playerAccountCardIds();
		if (accountCardIds.length) {
			await loadPlayerCards(accountCardIds);
			return;
		}

		const { player } = selectedDeckIds();
		const chosen = (await getDeckById(player)) ?? (await getPlayerDeck());

		if (!chosen || (!chosen.main.length && !chosen.extra.length)) {
			await loadCards(1);
			return;
		}

		// This game has no separate extra deck: Fusion / Ritual monsters (which
		// imported decks file under `extra`) are drawn from the main deck like any
		// card, so both sections feed one draw pile. Only enabled cards make it in:
		// drop the ids the owner turned off in the deck editor, and pass the deck's
		// forced ids so cards toggled on despite being flagged not playable are kept.
		const cardIds = [...chosen.main, ...chosen.extra];
		await loadPlayerCards(enabledCardIds(chosen, cardIds), forcedCardIds(chosen));
	}

	// Load the deck chosen for the CPU rival on the home page (via the `?cpu=`
	// query param), falling back to the last board selection, so it has creatures
	// to summon on its turns. Only placeable (billboard) monsters are kept.
	async function loadCpuDeck() {
		const { cpu } = selectedDeckIds();
		const chosen = (await getDeckById(cpu)) ?? (await getCpuDeck());
		if (!chosen || (!chosen.main.length && !chosen.extra.length)) return;

		try {
			// Same as the player's deck: fold the extra deck (Fusion / Ritual monsters)
			// into the one draw pile, enabled ids only, resolved playable-only, with the
			// deck's forced ids kept past the playable verdict. The rival draws its
			// opening hand at the start of its first turn (see runCpuTurn).
			const cardIds = [...chosen.main, ...chosen.extra];
			await cpuAdapter.loadByIds(enabledCardIds(chosen, cardIds), true, forcedCardIds(chosen));
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
		// Hovering a played card shows it in the fixed card viewer, exactly like the hand
		// cards — so both the player's and the rival's out-of-grid plaque cards can be read
		// at full size. The viewer is pinned to the page's bottom-left and keeps the last
		// hovered card, so there is nothing to tear down on pointerleave.
		sprite.eventMode = 'static';
		sprite.cursor = 'pointer';
		sprite.on('pointerenter', () => showCardPreview(card.id));
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
// right sidebar and the board plaques use) as a single row under the player's red
// board plaque, on the grid's bottom-right side. Like the red/blue plaques it lives
// inside `camera`, so it pans and zooms with the board — but unlike them the cards are
// drawn upright (plain sprites, no
// isometric shear), standing rather than lying flat. Each card is two grid cells wide.
// Calibrated against the on-screen grid: the sprite.width setter on the loaded PNG
// renders at ~2× the nominal value (unlike the .scale.set() the board billboards use),
// so CELL_WIDTH here — not 2 × CELL_WIDTH — spans two drawn (gap-applied) tiles. Its
// height follows the 1080×1415 PNG aspect so the art isn't distorted.
const HAND_CARD_W = CELL_WIDTH;
const HAND_CARD_H = (HAND_CARD_W * 1415) / 1080;
const HAND_CARD_GAP = 6;
// World-px the hand row is pushed outward (down-right) past the player's plaque, so the
// upright cards clear the plaque's played-card section they now sit beyond.
const HAND_OUT_GAP = 28;

// The world-space hand row (built in init, added to `camera`) and a token bumped on
// each render so a slow PNG load from a superseded render can't paint a stale card.
let handLayer: Container | undefined;
let handToken = 0;

// The rival's hand row: the mirror of `handLayer` on the board's top-left end, drawn as
// face-down card backs (the rival's cards stay hidden). Built in init inside `camera` so it
// pans and zooms with the board; its own token guards a superseded card-back load.
let cpuHandLayer: Container | undefined;
let cpuHandToken = 0;

// The face-down card back (/assets/card-back.png), loaded once in init and reused for every
// rival hand card. $state so renderCpuHand's $effect repaints the backs once the art lands.
let cardBackTexture: Texture | null = $state(null);

// The card viewer: the id of whichever card the pointer last hovered on the canvas (a
// hand card, a played plaque card, or an on-board creature), or null until the first hover.
// The viewer is sticky — leaving a card leaves its art on show, so the last card visited
// stays readable while the pointer is back on the board. The in-canvas hover handlers set
// it via showCardPreview; the board page reads previewCardSrc and renders it as a fixed
// 300px <img> pinned to the page's bottom-left (so the viewer is a DOM element, immune to
// the board's pan/zoom). $state so the img reacts.
let previewCardId = $state<IGameCreature['id'] | null>(null);

// The placed unit the viewer's card belongs to, when it was hovered on the board (null
// when the card came from the hand or a plaque, so it isn't a unit that can act). Kept
// as an id, like hoveredActionUnitId, so it stays reactive without wrapping the unit's
// live Pixi objects in a proxy — it's what previewUnitActions looks the unit up from, to
// give the DOM viewer the same Move / Combat buttons the creature unfolds on the board.
let previewUnitId = $state<number | null>(null);

// The world-space column of turn/unit action buttons (Move/Combat/Unfold/End Turn),
// built in init and added to `camera` so it pans and zooms with the board. It sits
// just under the player's red energy-dice row (see renderActionButtons).
let actionLayer: Container | undefined;

// The world-space layer holding each side's remaining match dice, drawn as a grid of
// little static isometric dice laid past that side's card plaque (see renderDiceDisplay).
// Built in init inside `camera` so the dice pan and zoom with the board; the player's are
// clickable during the turn-start pick (the on-canvas replacement for the old dice modal).
let diceDisplayLayer: Container | undefined;
let diceDisplayToken = 0;

// The player's currently-drawn cube nodes, keyed by die id, so the turn-start roll can
// tumble the picked dice in place on the 2D grid before they leave the pool. Rebuilt every
// renderDiceDisplay pass (the layer's children are destroyed and re-created each time), so
// callers must read it right after a render and never hold a node across one.
let diceNodeById = new Map<string, Container>();

// The rival's cube nodes, keyed by die id — the mirror of `diceNodeById` for the CPU, so the
// rival's turn-start roll can tumble its picked cubes in place before they leave its pool.
// Rebuilt every renderDiceDisplay pass alongside the player's map.
let rivalDiceNodeById = new Map<string, Container>();

// Layout of the on-canvas action-button column: each button's width and height, the
// vertical gap between stacked buttons, and the gap between the red dice row above and
// the top of the column.
const ACTION_BTN_W = 150;
const ACTION_BTN_H = 30;
const ACTION_BTN_GAP = 8;
const ACTION_DICE_GAP = 28;

// A pill-shaped "Summon" button centered on a hand card, mirroring the DOM hand
// tray's Select overlay button. Enabled buttons paint primary-blue; disabled ones
// (unaffordable card, or a summon/move/combat already in flight) paint gray and take
// no clicks. Sized to a fixed `width` (the hand card is narrow — ~54px — so the button
// is pinned to a fraction of it rather than growing to its label); the label is scaled
// down when needed so it never overflows that width. Returned as a self-contained
// Container of exactly `width`; the caller positions and wires it.
function buildSummonButton(text: string, enabled: boolean, width: number): Container {
	const btn = new Container();

	const label = new Text({
		text,
		style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' },
		resolution: LABEL_RESOLUTION
	});
	label.anchor.set(0.5);

	// Shrink the label to fit inside the button width (with a small inner margin) so a
	// long word like "Selected" can't spill past the pill on the narrow hand card.
	const innerPad = 6;
	const maxLabelW = width - innerPad * 2;
	if (label.width > maxLabelW) label.scale.set(maxLabelW / label.width);

	const padY = 5;
	const h = label.height + padY * 2;

	const bg = new Graphics()
		.roundRect(0, 0, width, h, 6)
		.fill({ color: enabled ? 0x2563eb : 0x4b5563 });
	btn.addChild(bg);

	label.position.set(width / 2, h / 2);
	btn.addChild(label);

	return btn;
}

// Draw one hand card as an upright PNG at world (x, y) (its top-left) from an already-
// loaded texture, or a "card not found" placeholder when the bitmap is missing — the
// same fallback the plaques and hand tiles use. Synchronous: renderHand preloads every
// texture first, so the whole hand is laid down in one atomic pass (no per-card await,
// so a re-render can't leave a half-drawn hand).
//
// The card is a single container: clicking it inspects the card (like the DOM hand
// tile), and hovering reveals a darkening scrim with a centered Summon button that
// flags the card for placement (like the tile's Select overlay). Cards too costly for
// the current energy pool are shown at 70% opacity with their Summon button disabled,
// echoing the sidebar's dimmed tiles.
function addHandCard(card: IGameCreature, x: number, y: number, texture: Texture | null) {
	if (!handLayer) return;

	const affordable = canSummon(card);

	// The whole card as one pointer target, positioned at the card's world corner so its
	// children lay out in local (0,0)-based coords. Unaffordable cards are drawn at 70%
	// opacity and desaturated to black-and-white (the canvas echo of the DOM tray's
	// grayscale + dimmed tiles).
	const cardContainer = new Container();
	cardContainer.position.set(x, y);
	cardContainer.alpha = affordable ? 1 : 0.7;
	if (!affordable) {
		const grayscale = new ColorMatrixFilter();
		grayscale.desaturate();
		cardContainer.filters = [grayscale];
	}
	cardContainer.eventMode = 'static';
	cardContainer.cursor = 'pointer';
	// Clicking an on-canvas hand card inspects it, exactly like clicking its tile in the
	// DOM hand tray (both call inspectCard, loading it into the detail panel).
	cardContainer.on('pointertap', () => inspectCard(card));

	if (texture) {
		const sprite = new Sprite(texture);
		sprite.width = HAND_CARD_W;
		sprite.height = HAND_CARD_H;
		cardContainer.addChild(sprite);
	} else {
		const box = new Graphics()
			.rect(0, 0, HAND_CARD_W, HAND_CARD_H)
			.fill({ color: 0x000000, alpha: 0.3 })
			.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
		cardContainer.addChild(box);

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
		label.position.set(HAND_CARD_W / 2, HAND_CARD_H / 2);
		cardContainer.addChild(label);
	}

	// Hover overlay: a darkening scrim plus the centered Summon button, both hidden until
	// the pointer enters the card (pointerenter/leave, so moving onto the button doesn't
	// toggle it off the way bubbling over/out would).
	const hover = new Container();
	hover.visible = false;

	const scrim = new Graphics()
		.rect(0, 0, HAND_CARD_W, HAND_CARD_H)
		.fill({ color: 0x000000, alpha: 0.3 });
	scrim.eventMode = 'none';
	hover.addChild(scrim);

	const selected = selectedMonster?.id === card.id || specialCard?.id === card.id;
	// A staged special summon locks the whole hand until it resolves (or cancels),
	// so no second card can be selected mid-sacrifice.
	const canAct = affordable && !summoning && !moving && !combating && !specialPhase;
	// The button spans 80% of the card's width, centered on it.
	const button = buildSummonButton(selected ? 'Selected' : 'Summon', canAct, HAND_CARD_W * 0.8);
	button.position.set((HAND_CARD_W - button.width) / 2, (HAND_CARD_H - button.height) / 2);
	if (canAct) {
		button.eventMode = 'static';
		button.cursor = 'pointer';
		// Summon selects the card for placement; stopPropagation keeps the same click from
		// also inspecting the card via the container's handler.
		button.on('pointertap', (e) => {
			e.stopPropagation();
			selectMonster(card);
		});
	}
	hover.addChild(button);
	cardContainer.addChild(hover);

	// On hover, reveal the in-card Summon overlay AND show this card's full art in the
	// bottom-left DOM viewer (only when its art actually loaded). Leaving hides the overlay
	// but leaves the viewer showing this card, until another card is hovered.
	cardContainer.on('pointerenter', () => {
		hover.visible = true;
		if (texture) showCardPreview(card.id);
	});
	cardContainer.on('pointerleave', () => {
		hover.visible = false;
	});

	handLayer.addChild(cardContainer);
}

// Set the card the DOM viewer shows. The single entry point the in-canvas hover handlers
// call — hovering a hand card, a played plaque card, or an on-board creature sets its id
// here. There is no clear: the viewer holds the last hovered card until another one
// replaces it. `unitId` is the placed unit the card was hovered on, when it came from the
// board — it earns the viewer its action buttons; hand and plaque cards pass none. The
// board page reactively renders previewCardSrc as the fixed bottom-left viewer, so
// positioning is pure CSS.
function showCardPreview(cardId: IGameCreature['id'], unitId: number | null = null) {
	previewCardId = cardId;
	previewUnitId = unitId;
}


// (Re)draw the player's hand from scratch for the current `hand` (in draw order), as a
// single row of upright cards past the player's plaque on the board's bottom-right — just
// beyond the played-card section, where the match dice used to sit before the two swapped
// sides. The anchor is computed in world coords from the plaque's ground matrix, so the
// row tracks the grid as the camera pans/zooms. Reactive to `hand` and the summon energy
// pool (the latter drives the affordability dim); a no-op until the container exists (init
// creates it once the board is built).
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

	// The hand sits past the player's plaque on the grid's bottom-right — just beyond the
	// played-card section, where the match dice used to be (the two swapped sides). The
	// cards keep their upright-billboard look, laid as a diagonal row hugging the plaque's
	// outer edge: diceBlockAxes gives that edge — mid at the plaque's outer-edge midpoint,
	// uHat along its length, vHat pointing outward (down-right, away from the grid).
	const { uHat, vHat, mid } = diceBlockAxes(PLAYER_BOARD_MATRIX);
	// Rise-over-run of the plaque's outer edge (the bottom-right iso diagonal, slope -1/2).
	const edgeSlope = uHat.y / uHat.x;
	// The anchor line: the plaque's outer edge pushed one HAND_OUT_GAP outward so the upright
	// cards, whose bodies hang down-right from this line, clear the plaque's card section.
	const anchorX = mid.x + vHat.x * HAND_OUT_GAP;
	const anchorY = mid.y + vHat.y * HAND_OUT_GAP;

	// Lay the hand cheapest-first as a row stepped in x and centred on the plaque's length.
	// Each card's top-left rides the anchor line (its y follows the edge slope), so the
	// upright cards staircase up-right along the plaque while their bodies hang outward.
	const ordered = [...hand].sort((a, b) => a.cost - b.cost);
	const step = HAND_CARD_W + HAND_CARD_GAP;
	const startX = anchorX - ((ordered.length - 1) * step) / 2 - HAND_CARD_W / 2;

	const placements: { card: IGameCreature; x: number; y: number }[] = [];
	ordered.forEach((card, i) => {
		const x = startX + i * step;
		const y = anchorY + edgeSlope * (x - anchorX);
		placements.push({ card, x, y });
	});

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
// the affordability dim tracks the current energy), and whenever the summon-button state
// changes — the selected card (Summon → Selected) or an in-flight summon / move / combat
// that disables it. Guarded until the container exists.
$effect(() => {
	void hand;
	// The hand's affordability dim tracks the summon pool (canSummon spends it).
	void energy.summon;
	void selectedMonster;
	void summoning;
	void moving;
	void combating;
	void specialCard;
	void specialPhase;
	renderHand();
});

// Draw one rival hand card as a face-down card back at world (x, y) (its top-left), the same
// HAND_CARD_W × HAND_CARD_H box the player's cards use so both hands read at the same size.
// Passive: the rival's cards are hidden, so there are no click / hover / summon affordances —
// just the back art (or a plain placeholder if it hasn't loaded).
function addCpuHandCard(x: number, y: number, texture: Texture | null) {
	if (!cpuHandLayer) return;

	const cardContainer = new Container();
	cardContainer.position.set(x, y);
	cardContainer.eventMode = 'none';

	if (texture) {
		const sprite = new Sprite(texture);
		sprite.width = HAND_CARD_W;
		sprite.height = HAND_CARD_H;
		cardContainer.addChild(sprite);
	} else {
		const box = new Graphics()
			.rect(0, 0, HAND_CARD_W, HAND_CARD_H)
			.fill({ color: 0x1b1b3a, alpha: 0.85 })
			.stroke({ width: 1, color: 0xffffff, alpha: 0.4 });
		cardContainer.addChild(box);
	}

	cpuHandLayer.addChild(cardContainer);
}

// (Re)draw the rival's hand as a single row of face-down card backs, mirroring the player's
// renderHand but on the board's opposite (top-left) end: laid along the rival plaque's outer
// edge from its ground matrix, so the row tracks the grid as the camera pans/zooms. Upright like
// the player's cards, but lifted by a card height so the standing backs rise up-left away from
// the grid (the player's hang down-right) — the true mirror of the player's fan. Reactive to
// `cpuHand`; a no-op until the container exists. Loads the shared back texture (cached by Assets)
// before the atomic redraw, with a token guard so a superseded render is dropped wholesale.
async function renderCpuHand() {
	if (!cpuHandLayer) return;
	const token = ++cpuHandToken;

	if (!cpuHand.length) {
		for (const child of cpuHandLayer.removeChildren()) child.destroy();
		return;
	}

	// The rival plaque's outer edge (diceBlockAxes on its ground matrix): mid at the edge
	// midpoint, uHat along its length, vHat pointing outward (up-left, away from the grid) — the
	// point-reflection of the axes the player's hand uses.
	const { uHat, vHat, mid } = diceBlockAxes(RIVAL_BOARD_MATRIX);
	const edgeSlope = uHat.y / uHat.x;
	// Push the anchor line outward past the plaque, then lift it by a full card height so the
	// upright backs stand ABOVE the line (rising away from the grid) instead of hanging onto it.
	const anchorX = mid.x + vHat.x * HAND_OUT_GAP;
	const anchorY = mid.y + vHat.y * HAND_OUT_GAP - HAND_CARD_H;

	// A row stepped in x and centred on the plaque's length, each back's top-left riding the
	// anchor line (its y follows the edge slope) — the same layout as the player's hand.
	const step = HAND_CARD_W + HAND_CARD_GAP;
	const startX = anchorX - ((cpuHand.length - 1) * step) / 2 - HAND_CARD_W / 2;

	const placements = cpuHand.map((_, i) => {
		const x = startX + i * step;
		const y = anchorY + edgeSlope * (x - anchorX);
		return { x, y };
	});

	const texture = await Assets.load<Texture>('/assets/card-back.png').catch(() => null);

	// A newer render superseded this one while the back loaded — drop it wholesale.
	if (token !== cpuHandToken || !cpuHandLayer) return;

	for (const child of cpuHandLayer.removeChildren()) child.destroy();
	placements.forEach((p) => addCpuHandCard(p.x, p.y, texture));
}

// Repaint the rival's hand whenever it changes (a draw at turn start or a summon spending a
// card) or the back texture finishes loading. Guarded until the container exists.
$effect(() => {
	void cpuHand;
	void cardBackTexture;
	renderCpuHand();
});

// The theme colors for a canvas action button: DaisyUI's primary (blue), error (red)
// and a neutral outline gray, matching the DOM buttons these replace.
const ACTION_VARIANTS = {
	primary: 0x2563eb,
	error: 0xdc2626,
	neutral: 0x4b5563
} as const;

// One button in the on-canvas action column: a filled rounded rect of the fixed column
// width with a centered label. Enabled buttons take the variant color and fire onClick;
// disabled ones are dimmed and inert. Positioned by the caller (top-left at y).
function buildActionButton(
	label: string,
	variant: keyof typeof ACTION_VARIANTS,
	enabled: boolean,
	onClick: () => void
): Container {
	const btn = new Container();
	btn.alpha = enabled ? 1 : 0.45;

	const bg = new Graphics()
		.roundRect(0, 0, ACTION_BTN_W, ACTION_BTN_H, 6)
		.fill({ color: ACTION_VARIANTS[variant] });
	btn.addChild(bg);

	const text = new Text({
		text: label,
		style: { fill: 0xffffff, fontSize: 13, fontWeight: 'bold' },
		resolution: LABEL_RESOLUTION
	});
	text.anchor.set(0.5);
	// Shrink an over-long label to fit inside the button width.
	const maxTextW = ACTION_BTN_W - 16;
	if (text.width > maxTextW) text.scale.set(maxTextW / text.width);
	text.position.set(ACTION_BTN_W / 2, ACTION_BTN_H / 2);
	btn.addChild(text);

	if (enabled) {
		btn.eventMode = 'static';
		btn.cursor = 'pointer';
		btn.on('pointertap', onClick);
	}

	return btn;
}

// A non-interactive, word-wrapped instruction plaque sized to the action-column
// width — used to caption a staged Fusion / Ritual summon above its buttons.
function buildActionPrompt(text: string): Container {
	const c = new Container();

	const label = new Text({
		text,
		style: {
			fill: 0xffffff,
			fontSize: 12,
			fontWeight: 'bold',
			align: 'center',
			wordWrap: true,
			wordWrapWidth: ACTION_BTN_W - 12
		},
		resolution: LABEL_RESOLUTION
	});
	label.anchor.set(0.5, 0);

	const h = label.height + 12;
	const bg = new Graphics().roundRect(0, 0, ACTION_BTN_W, h, 6).fill({ color: 0x1f2937, alpha: 0.9 });
	c.addChild(bg);

	label.position.set(ACTION_BTN_W / 2, 6);
	c.addChild(label);

	return c;
}

// Stack a column of action rows just below the player's red energy-dice row, each
// row laid out by its own height so a taller prompt plaque doesn't overlap the
// buttons beneath it.
function stackActionRows(rows: Container[], diceCenter: { x: number; y: number }) {
	if (!actionLayer) return;
	const diceHalf = playerEnergyDice?.diceHalfExtent(3) ?? 0;
	const leftX = diceCenter.x - ACTION_BTN_W / 2;
	let y = diceCenter.y + diceHalf + ACTION_DICE_GAP;
	for (const row of rows) {
		row.position.set(leftX, y);
		actionLayer.addChild(row);
		y += row.height + ACTION_BTN_GAP;
	}
}

// (Re)draw the column of action buttons under the player's red energy-dice row. The
// buttons mirror the ones the DOM inspect panel used to hold: Move/Combat for the
// inspected player unit (collapsing to a single Cancel while a move or combat is in
// flight), then the turn actions Unfold and End Turn. A no-op until the layer and the
// red origin exist. Reactive via the $effect below, so labels and enabled states track
// the game as it changes.
function renderActionButtons() {
	if (!actionLayer) return;
	for (const child of actionLayer.removeChildren()) child.destroy();

	// The buttons hang under the player's red energy dice; without that anchor there's
	// nowhere to put them.
	const diceCenter = turnDiceCenterFor(redOrigin, false);
	if (!diceCenter) return;

	// A staged Fusion / Ritual summon takes over the column: a wrapped instruction,
	// then Cancel while still picking sacrifices. Selecting a satisfying set advances
	// to placement automatically (no Confirm step). During placement only the
	// instruction shows — the sacrifices are already spent and the tile is clicked
	// directly, so there's nothing to cancel.
	if (specialPhase) {
		const rows: Container[] = [buildActionPrompt(specialPrompt)];
		if (specialPhase === 'materials') {
			rows.push(buildActionButton('Cancel', 'error', true, cancelSpecialSummon));
		}
		stackActionRows(rows, diceCenter);
		return;
	}

	// The per-unit Move / Combat actions now unfold beneath the hovered creature on
	// the board (see renderUnitActions), so this off-board column carries only the
	// turn actions: Unfold and End Turn.
	const rows: Container[] = [];
	rows.push(
		buildActionButton(
			unfolding ? 'Cancel Unfold' : `Unfold (${UNFOLD_COST})`,
			unfolding ? 'neutral' : 'primary',
			!rivalThinking && !rolling && (unfolding || energy.summon >= UNFOLD_COST),
			startUnfold
		)
	);
	rows.push(
		buildActionButton(
			rolling ? 'Rolling…' : 'End Turn',
			'neutral',
			energyRolled && !rolling && !rivalThinking && !pickingDice,
			endTurn
		)
	);

	// Stack the buttons in a centered column just below the dice row.
	stackActionRows(rows, diceCenter);
}

// Repaint the off-board turn-action column whenever any state feeding a button's label
// or enabled flag changes: the summon energy pool and whether it's been rolled, and the
// unfold/roll/rival/special flags. (Move / Combat moved to the on-board hover buttons.)
$effect(() => {
	void energy.summon;
	void energyRolled;
	void pickingDice;
	void unfolding;
	void rolling;
	void rivalThinking;
	void specialPhase;
	void specialReady;
	void specialPrompt;
	renderActionButtons();
});

// The layout of the Move / Combat buttons that unfold beneath a hovered player creature.
// Sized in world units — they live in the `overlays` layer alongside the HP bars, so they
// read at a constant board size through pan and zoom. The column is a touch wider than a
// cell so each label fits beside its cost icon; its top sits HP_BAR_GAP below the
// creature's feet, mirroring the gap the HP bar floats above the creature's top edge.
const UNIT_ACTION_BTN_W = CELL_WIDTH * 1.7;
const UNIT_ACTION_BTN_H = 15;
const UNIT_ACTION_BTN_GAP = 3;
const UNIT_ACTION_ICON = 12; // drawn height (world px) of a cost element icon

// One on-board action button beneath a creature: a filled rounded rect with a left-aligned
// label and, for the paid actions (Move / Combat), the action's cost printed at the right
// beside its element icon — the same summon / move / attack glyph the energy counters show —
// so the player reads what each action will spend. A role of null (e.g. a Cancel button)
// centers the label and prints no cost. Sized in world units; the caller positions it.
function buildUnitActionButton(
	label: string,
	variant: keyof typeof ACTION_VARIANTS,
	enabled: boolean,
	role: DiceRole | null,
	cost: number,
	onClick: () => void
): Container {
	const btn = new Container();
	btn.alpha = enabled ? 1 : 0.45;

	const bg = new Graphics()
		.roundRect(0, 0, UNIT_ACTION_BTN_W, UNIT_ACTION_BTN_H, 4)
		.fill({ color: ACTION_VARIANTS[variant] });
	btn.addChild(bg);

	const padX = 6;
	const text = new Text({
		text: label,
		style: { fill: 0xffffff, fontSize: 10, fontWeight: 'bold' },
		resolution: LABEL_RESOLUTION
	});

	if (role) {
		// label on the left, cost cluster (icon + value) on the right.
		text.anchor.set(0, 0.5);
		text.position.set(padX, UNIT_ACTION_BTN_H / 2);
		btn.addChild(text);

		const costText = new Text({
			text: String(cost),
			style: { fill: 0xffffff, fontSize: 10, fontWeight: 'bold' },
			resolution: LABEL_RESOLUTION
		});
		costText.anchor.set(1, 0.5);
		costText.position.set(UNIT_ACTION_BTN_W - padX, UNIT_ACTION_BTN_H / 2);
		btn.addChild(costText);

		const icon = roleIconTex[role];
		if (icon) {
			const iconSprite = new Sprite(icon);
			iconSprite.anchor.set(1, 0.5);
			iconSprite.scale.set(UNIT_ACTION_ICON / (icon.height || 1));
			// Sit just left of the cost number.
			iconSprite.position.set(
				UNIT_ACTION_BTN_W - padX - costText.width - 3,
				UNIT_ACTION_BTN_H / 2
			);
			btn.addChild(iconSprite);
		}
	} else {
		text.anchor.set(0.5);
		text.position.set(UNIT_ACTION_BTN_W / 2, UNIT_ACTION_BTN_H / 2);
		btn.addChild(text);
	}

	if (enabled) {
		btn.eventMode = 'static';
		btn.cursor = 'pointer';
		// stopPropagation so the tap that fires the action doesn't also fall through to
		// the tile beneath the button.
		btn.on('pointertap', (e) => {
			e.stopPropagation();
			onClick();
		});
	}

	return btn;
}

// The Move / Combat actions available to a player unit right now, mirroring the old
// off-board column's enablement: Move needs its cost in the move pool, Combat needs its
// cost in the attack pool and a target in reach; both are inert while the rival is
// thinking or a summon is resolving. While a move / combat is in flight the pair
// collapses to a single Cancel. Returned as data so the on-board Pixi buttons and the
// DOM card viewer's button row both render the exact same set (see UnitAction).
function unitActions(unit: PlacedUnit): UnitAction[] {
	const cost = unit.creature.cost;
	const controlsDisabled = rivalThinking || summoning;
	const iconFor = (role: DiceRole) => diceConfig?.roles[role]?.icon ?? null;

	if (moving && movingUnit === unit) {
		return [
			{
				key: 'cancel-move',
				label: 'Cancel Move',
				variant: 'error',
				enabled: true,
				role: null,
				cost: 0,
				iconSrc: null,
				run: cancelMove
			}
		];
	}

	if (combating && attackingUnit === unit) {
		return [
			{
				key: 'cancel-combat',
				label: 'Cancel Combat',
				variant: 'error',
				enabled: true,
				role: null,
				cost: 0,
				iconSrc: null,
				run: cancelCombat
			}
		];
	}

	return [
		{
			key: 'move',
			label: 'Move',
			variant: 'primary',
			enabled: !controlsDisabled && energy.move >= cost,
			role: 'move',
			cost,
			iconSrc: iconFor('move'),
			run: () => startMove(unit)
		},
		{
			key: 'combat',
			label: 'Combat',
			variant: 'primary',
			enabled: !controlsDisabled && energy.attack >= cost && combatTargetsFor(unit).length > 0,
			role: 'attack',
			cost,
			iconSrc: iconFor('attack'),
			run: () => startCombat(unit)
		}
	];
}

// Draw a unit's current actions as the stacked on-board buttons that unfold beneath it.
function buildUnitActionRows(unit: PlacedUnit): Container[] {
	return unitActions(unit).map((action) =>
		buildUnitActionButton(
			action.label,
			action.variant,
			action.enabled,
			action.role,
			action.cost,
			action.run
		)
	);
}

// Give a unit its (empty, hidden) action group, parented in `overlays` so it renders above
// the sprites and never dims with the creature. The group keeps its own pointer handlers so
// sliding the pointer off the sprite onto the buttons doesn't close them; an invisible
// backdrop (added in renderUnitActions) bridges the gap up to the creature's feet.
function ensureActionGroup(unit: PlacedUnit) {
	if (unit.actionGroup) return;
	const group = new Container();
	group.visible = false;
	group.eventMode = 'static';
	group.on('pointerenter', () => {
		hoveredActionUnitId = unit.unitId;
	});
	group.on('pointerleave', () => {
		if (hoveredActionUnitId === unit.unitId) hoveredActionUnitId = null;
	});
	overlays.addChild(group);
	unit.actionGroup = group;
	positionUnitActions(unit);
}

// Pin a unit's action group to the world point HP_BAR_GAP below the creature's feet
// (sprite.y is the feet — anchor.y = 1), mirroring the HP bar's gap above the sprite's top
// edge. Its rows lay out downward from that origin.
function positionUnitActions(unit: PlacedUnit) {
	if (!unit.actionGroup) return;
	unit.actionGroup.position.set(unit.sprite.x, unit.sprite.y + HP_BAR_GAP);
}

// Repaint the on-board action buttons: unfold the Move / Combat pair (or a Cancel) beneath
// whichever player unit is the current focus — the one being moved or attacked with (so its
// Cancel stays reachable after the pointer leaves it to pick a destination), else the hovered
// one — and hide every other unit's group.
function renderUnitActions() {
	let focus: PlacedUnit | null = null;
	if (moving && movingUnit) focus = movingUnit;
	else if (combating && attackingUnit) focus = attackingUnit;
	else if (hoveredActionUnitId != null) focus = placedUnits.get(hoveredActionUnitId) ?? null;

	// Only the player's own creatures get action buttons.
	if (focus && focus.side !== 'player') focus = null;

	for (const unit of placedUnits.values()) {
		const group = unit.actionGroup;
		if (!group) continue;

		if (unit !== focus) {
			if (group.visible) {
				for (const child of group.removeChildren()) child.destroy();
				group.visible = false;
			}
			continue;
		}

		for (const child of group.removeChildren()) child.destroy();
		const rows = buildUnitActionRows(unit);

		// An invisible, interactive backdrop spanning from the creature's feet down past the
		// buttons, so the pointer crossing the HP_BAR_GAP gap between the sprite and the
		// buttons stays "inside" the group and keeps them open.
		const totalH = HP_BAR_GAP + rows.length * (UNIT_ACTION_BTN_H + UNIT_ACTION_BTN_GAP);
		const backdrop = new Graphics()
			.rect(-UNIT_ACTION_BTN_W / 2, -HP_BAR_GAP, UNIT_ACTION_BTN_W, totalH)
			.fill({ color: 0x000000, alpha: 0.001 });
		backdrop.eventMode = 'static';
		group.addChild(backdrop);

		let y = 0;
		for (const row of rows) {
			row.position.set(-UNIT_ACTION_BTN_W / 2, y);
			group.addChild(row);
			y += UNIT_ACTION_BTN_H + UNIT_ACTION_BTN_GAP;
		}

		group.visible = true;
		positionUnitActions(unit);
	}
}

// Repaint the on-board action buttons whenever the hovered/acting unit or any state feeding
// a button's label or enabled flag changes (the move/attack energy pools, the move/combat
// flags, the rival/summon locks) or the cost icons finish loading.
$effect(() => {
	void hoveredActionUnitId;
	void energy.move;
	void energy.attack;
	void moving;
	void combating;
	void rivalThinking;
	void summoning;
	void roleIconsReady;
	renderUnitActions();
});

// The three energy pools in the order they read on the board (summon, move, attack). The
// role counters beside each side's dice pool (see renderDiceDisplay) and sortDiceByRole
// both key off this order.
const ENERGY_ROWS: { role: DiceRole }[] = [
	{ role: 'summon' },
	{ role: 'move' },
	{ role: 'attack' }
];

// --- On-board match-dice display -------------------------------------------------
//
// Each side's remaining match dice (playerDice / rivalDice) are drawn as a grid of
// little static isometric dice laid on the ground just past that side's card plaque,
// each die turned so its highest-value face crowns the cube. This is both a live view
// of the pool — it shrinks as dice are rolled and consumed — and, for the player, the
// turn-start picker: while the pick phase is open the player's dice are click-to-select
// (up to the roll's pickCount) with a Roll button past the block, replacing the old DOM
// dice modal.

// Approximate drawn size of one displayed die and the grid it lays out in: dice per
// row across the plaque's length, the step between dice along that length and between
// rows marching outward, and the gap from the plaque's outer edge to the first row —
// all in world (pre-camera) px, along the plaque's own two in-plane axes.
const MATCH_DIE_SIZE = 42;
const MATCH_DIE_COLS = 6;
const MATCH_DIE_COL_STEP = 50;
const MATCH_DIE_ROW_STEP = 40;
const MATCH_DIE_OUT_GAP = 30;

// The number of rows a fully stocked dice block spans (MATCH_DIE_COLS × this = the full
// pool). Used to reserve the block's footprint so the hand and the board frame leave room
// for the whole pool even before any die is consumed.
const MATCH_DICE_MAX_ROWS = 3;

// The three face indices (1-based) an isometric cube shows for a die — highest value
// turned up, the next two on the left and right sides — so each face's baked art can be
// located (`<id>-<face>.png`) and mapped onto the cube.
function dieCubeFaces(die: SpawnedDie): { top: number; left: number; right: number } {
	return orderedDieFaces(die.faces.map((f) => parseInt(f.value, 10)));
}

// A plaque's two in-plane unit axes (uHat along its length, vHat along its outward
// thickness) and the world midpoint of its outer edge — the anchor the dice grid grows
// out from. Derived from the plaque's ground matrix so the grid lies in the same
// isometric plane as the plaque and marches away from the board.
function diceBlockAxes(matrix: Matrix): {
	uHat: { x: number; y: number };
	vHat: { x: number; y: number };
	mid: { x: number; y: number };
} {
	const uLen = Math.hypot(matrix.a, matrix.b) || 1;
	const vLen = Math.hypot(matrix.c, matrix.d) || 1;
	const mid = matrix.apply({ x: TAG_WIDTH / 2, y: TAG_HEIGHT });
	return {
		uHat: { x: matrix.a / uLen, y: matrix.b / uLen },
		vHat: { x: matrix.c / vLen, y: matrix.d / vLen },
		mid: { x: mid.x, y: mid.y }
	};
}

// The player's match-dice block no longer hangs off the plaque — it now sits past the
// grid's bottom-left border (the edge from the L12 bottom corner to the A12 left corner),
// where the hand used to be, the two having swapped sides. These are the block's in-plane
// axes for matchDieCenter, the direct analogue of what diceBlockAxes derives from a plaque:
// uHat runs along that border and vHat marches outward past it. The dice stay flat isometric
// cubes — only the edge changed.
//
// Crucially both axes are the grid's OWN isometric floor axes, not a screen-space
// perpendicular to the border: the two iso diagonals aren't perpendicular on screen, so
// rotating uHat by 90° would skew the cube rows across the grid lines. uHat is the +x step
// (down-right, along the y = GRID_HEIGHT-1 border) and vHat is the +y step (down-left,
// pointing outward past that boundary, away from the interior).
//
// mid is placed so the block's first column lines up with the grid's left corner (the top
// of this border) rather than centring on the border's midpoint: the dice hug the grid's
// topmost row and cascade down-right toward the bottom corner. matchDieCenter still centres
// each row on mid, so mid is pushed down-right from the corner by half the block's along-
// span (plus a half-die inset) to land the leftmost column's edge on the corner. The pool
// always renders against the full slot count, so every row is full and top-anchors alike.
function playerDiceAxes(): {
	uHat: { x: number; y: number };
	vHat: { x: number; y: number };
	mid: { x: number; y: number };
} {
	// The isometric floor's unit axes, read straight off isoPosOf so they stay the true
	// 2:1 diagonals: uHat = one +x cell step, vHat = one +y cell step.
	const origin = isoPosOf(0, 0);
	const xStep = isoPosOf(1, 0);
	const yStep = isoPosOf(0, 1);
	const uLen = Math.hypot(xStep.x - origin.x, xStep.y - origin.y) || 1;
	const vLen = Math.hypot(yStep.x - origin.x, yStep.y - origin.y) || 1;
	const uHat = { x: (xStep.x - origin.x) / uLen, y: (xStep.y - origin.y) / uLen };
	const vHat = { x: (yStep.x - origin.x) / vLen, y: (yStep.y - origin.y) / vLen };

	// The grid's left corner: the outer point of the A12 cell, the top of this border.
	const leftCorner = isoPosOf(0, GRID_HEIGHT - 1);
	leftCorner.x -= TILE_WIDTH / 2;
	const halfSpan = ((MATCH_DIE_COLS - 1) / 2) * MATCH_DIE_COL_STEP + MATCH_DIE_SIZE / 2;
	const mid = { x: leftCorner.x + uHat.x * halfSpan, y: leftCorner.y + uHat.y * halfSpan };
	return { uHat, vHat, mid };
}

// The rival's match-dice block, the point-reflection of the player's: it sits past the grid's
// top-right border (the edge from the R1 right corner to the A1 top corner), the opposite end
// of the grid from the player's bottom-left block, so the two pools face each other across the
// board exactly as the two plaques do. Its in-plane axes are the player's floor axes negated —
// uHat runs up-left along that top border and vHat marches up-right outward past it — and mid is
// pinned so the block's first column lands on the grid's right corner and cascades up-left toward
// the top corner. matchDieCenter/roleCounterCenter/rollSpotAnchor all take these axes, so the
// rival's pool, counters and roll spot mirror the player's without any further special-casing.
function rivalDiceAxes(): {
	uHat: { x: number; y: number };
	vHat: { x: number; y: number };
	mid: { x: number; y: number };
} {
	const origin = isoPosOf(0, 0);
	const xStep = isoPosOf(1, 0);
	const yStep = isoPosOf(0, 1);
	const uLen = Math.hypot(xStep.x - origin.x, xStep.y - origin.y) || 1;
	const vLen = Math.hypot(yStep.x - origin.x, yStep.y - origin.y) || 1;
	// Negated player axes: the -x step (up-left, along the y = 0 border) and the -y step
	// (up-right, pointing outward past that boundary, away from the interior).
	const uHat = { x: -(xStep.x - origin.x) / uLen, y: -(xStep.y - origin.y) / uLen };
	const vHat = { x: -(yStep.x - origin.x) / vLen, y: -(yStep.y - origin.y) / vLen };

	// The grid's right corner: the outer point of the R1 cell (GRID_WIDTH-1, 0), the top of
	// this border. Push mid up-left by half the block's along-span (plus a half-die inset) so the
	// rightmost column's edge lands on the corner, mirroring how playerDiceAxes hugs its corner.
	const rightCorner = isoPosOf(GRID_WIDTH - 1, 0);
	rightCorner.x += TILE_WIDTH / 2;
	const halfSpan = ((MATCH_DIE_COLS - 1) / 2) * MATCH_DIE_COL_STEP + MATCH_DIE_SIZE / 2;
	const mid = { x: rightCorner.x + uHat.x * halfSpan, y: rightCorner.y + uHat.y * halfSpan };
	return { uHat, vHat, mid };
}

// World centre of die `k` (of `n`) in a side's grid: laid out in rows of MATCH_DIE_COLS
// along the plaque's length (uHat), each row centred on the outer-edge midpoint, with
// successive rows stepped outward along the thickness axis (vHat).
function matchDieCenter(
	k: number,
	n: number,
	mid: { x: number; y: number },
	uHat: { x: number; y: number },
	vHat: { x: number; y: number }
): { cx: number; cy: number } {
	const row = Math.floor(k / MATCH_DIE_COLS);
	const col = k % MATCH_DIE_COLS;
	const rowCount = Math.min(MATCH_DIE_COLS, n - row * MATCH_DIE_COLS);
	const along = (col - (rowCount - 1) / 2) * MATCH_DIE_COL_STEP;
	const out = MATCH_DIE_OUT_GAP + row * MATCH_DIE_ROW_STEP + MATCH_DIE_SIZE / 2;
	return {
		cx: mid.x + uHat.x * along + vHat.x * out,
		cy: mid.y + uHat.y * along + vHat.y * out
	};
}

// The world-space centre of a side's roll spot: the row one past the full dice block (where the
// player's Roll button sits), out along vHat. The block's row count is reckoned against the full
// pool (diceSlotCount) so the spot stays put as the pool is consumed. This is where the picked
// dice glide to, roll, and stay parked for the turn. Takes the side's axes so both the player
// (playerDiceAxes) and the rival (rivalDiceAxes) place their spot the same way.
function rollSpotAnchor(axes: {
	uHat: { x: number; y: number };
	vHat: { x: number; y: number };
	mid: { x: number; y: number };
}): { x: number; y: number } {
	const { vHat, mid } = axes;
	const slotTotal = diceSlotCount || 1;
	const rows = Math.max(1, Math.ceil(slotTotal / MATCH_DIE_COLS));
	const out = MATCH_DIE_OUT_GAP + rows * MATCH_DIE_ROW_STEP + MATCH_DIE_ROW_STEP;
	return { x: mid.x + vHat.x * out, y: mid.y + vHat.y * out };
}

// World centre of the k-th (of n) parked roll-spot die for a side: laid in a single row along
// its uHat, centred on that side's roll-spot anchor, mirroring how matchDieCenter centres a row.
function rolledDieCenter(
	k: number,
	n: number,
	axes: {
		uHat: { x: number; y: number };
		vHat: { x: number; y: number };
		mid: { x: number; y: number };
	}
): { x: number; y: number } {
	const { uHat } = axes;
	const anchor = rollSpotAnchor(axes);
	const along = (k - (n - 1) / 2) * MATCH_DIE_COL_STEP;
	return { x: anchor.x + uHat.x * along, y: anchor.y + uHat.y * along };
}

// The role-energy counters beside the pool: one per role (summon / move / attack), laid out as
// one more column of the dice pool — a single column-step to the right of the pool's last
// (highest-rarity) column, stacked down the pool's own depth rows — so they read as an extra
// column against the block. Each counter is the role's SVG face icon with its running energy
// total stacked directly beneath it, drawn upright (iso positioning only, no tilt). Always
// shown — at page start every total reads 0.
const ROLE_COUNTER_ICON = 26; // drawn height (px) of a counter icon
const ROLE_COUNTER_GAP = 3; // vertical gap between the icon and its value

// World centre of the k-th role counter: fixed one column past the block's last column
// (full-width row centring puts the last column at +((COLS-1)/2) steps, so the next column is
// one COL_STEP further along uHat), stepped down the pool's depth rows (vHat) by k so the
// counters stack alongside the block like an extra rarity column.
function roleCounterCenter(
	k: number,
	axes: {
		uHat: { x: number; y: number };
		vHat: { x: number; y: number };
		mid: { x: number; y: number };
	}
): { x: number; y: number } {
	const { uHat, vHat, mid } = axes;
	const along = (MATCH_DIE_COLS - (MATCH_DIE_COLS - 1) / 2) * MATCH_DIE_COL_STEP;
	const out = MATCH_DIE_OUT_GAP + k * MATCH_DIE_ROW_STEP + MATCH_DIE_SIZE / 2;
	return {
		x: mid.x + uHat.x * along + vHat.x * out,
		y: mid.y + uHat.y * along + vHat.y * out
	};
}

// Build one role counter: its icon with the value stacked directly under it, both centred on
// the counter's origin (so the caller pins it straight onto the iso column position). Drawn
// upright — only the column's position comes from the isometric layout, not any tilt.
function buildRoleCounter(tex: Texture | null, value: number): Container {
	const group = new Container();

	if (tex) {
		const icon = new Sprite(tex);
		icon.anchor.set(0.5, 1); // bottom-centre, so it sits just above the value
		icon.scale.set(ROLE_COUNTER_ICON / (tex.height || 1));
		icon.tint = 0xffffff;
		icon.position.set(0, -ROLE_COUNTER_GAP);
		group.addChild(icon);
	}

	const num = new Text({
		text: String(value),
		style: { fill: 0xffffff, fontSize: 20, fontWeight: 'bold' },
		resolution: LABEL_RESOLUTION
	});
	num.anchor.set(0.5, 0); // top-centre, directly below the icon
	num.position.set(0, ROLE_COUNTER_GAP);
	group.addChild(num);

	return group;
}

// (Re)draw both sides' remaining match dice past their blocks, plus each side's parked roll-spot
// dice and its role-energy counters. Preloads only the three visible faces of every die (cached
// by Assets), then rebuilds the layer in one pass with a token guard so a superseded render (a
// roll consuming dice mid-load) is dropped. The player's pool dice are wired click-to-pick while
// the turn-start phase is open, with a Roll button past the block; the rival's are always a
// passive display; the parked roll-spot dice are a passive display kept until the next roll.
async function renderDiceDisplay() {
	if (!diceDisplayLayer) return;
	const token = ++diceDisplayToken;
	const pixi = { Container, Graphics, Sprite, Matrix };

	// Each side's block, counters and roll spot lay out from its own axes: the player's along the
	// grid's bottom-left border (playerDiceAxes), the rival's along the opposite top-right border
	// (rivalDiceAxes). `energyPool` feeds that side's role counters and `parked` its roll-spot
	// dice, so the two sides render identically off their own state.
	const sides = [
		{
			dice: playerDice,
			axes: playerDiceAxes(),
			color: STATIC_DIE_BODY_COLOR,
			interactive: true,
			energyPool: energy,
			parked: rolledTurnDice
		},
		{
			dice: rivalDice,
			axes: rivalDiceAxes(),
			color: STATIC_DIE_BODY_COLOR,
			interactive: false,
			energyPool: cpuEnergy,
			parked: rivalRolledTurnDice
		}
	];

	// Preload the three faces each cube shows (top + two sides), keyed `${id}-${face}`.
	// The parked roll-spot dice have already left the pool, so add their faces too.
	const needed = new Set<string>();
	for (const die of [...playerDice, ...rivalDice, ...rolledTurnDice, ...rivalRolledTurnDice]) {
		const f = dieCubeFaces(die);
		needed.add(`${die.id}-${f.top}`);
		needed.add(`${die.id}-${f.left}`);
		needed.add(`${die.id}-${f.right}`);
	}

	// The three role counters beside the pool need each role's SVG icon (the same face art the
	// admin dice page paints — plain-arrow / pentacle / battle-axe). Preloaded once the config
	// is in; only three icons ever recur, so this set stays tiny.
	const iconUrls = new Set<string>();
	if (diceConfig)
		for (const { role } of ENERGY_ROWS) {
			const url = diceConfig.roles[role]?.icon;
			if (url) iconUrls.add(url);
		}

	const [texEntries, iconEntries] = await Promise.all([
		Promise.all(
			[...needed].map(
				async (key) =>
					[key, await Assets.load<Texture>(`${FACE_SRC_BASE}/${key}.png`).catch(() => null)] as const
			)
		),
		Promise.all(
			[...iconUrls].map(
				async (url) => [url, await Assets.load<Texture>(url).catch(() => null)] as const
			)
		)
	]);

	// A newer render superseded this one while the faces loaded — drop it wholesale.
	if (token !== diceDisplayToken || !diceDisplayLayer) return;
	const texByKey = new Map(texEntries);
	const iconTexByUrl = new Map(iconEntries);

	for (const child of diceDisplayLayer.removeChildren()) child.destroy();
	// The old cube nodes were just destroyed; start fresh id→node maps (one per side) for this
	// pass so each side's roll animation only ever sees live nodes from the current render.
	diceNodeById = new Map();
	rivalDiceNodeById = new Map();

	for (const side of sides) {
		const { uHat, vHat, mid } = side.axes;

		// Slots (and their centring) are reckoned against a full pool so every die keeps its
		// place for the whole match; an empty pool falls back to its own length.
		const slotTotal = diceSlotCount || side.dice.length;

		// Build each die, then add them back-to-front (smaller screen y first) so a die
		// nearer the viewer correctly overlaps the ones behind it.
		const built: { node: Container; cy: number }[] = [];
		side.dice.forEach((die) => {
			const f = dieCubeFaces(die);

			// Draw the die at its fixed match slot (against the full pool total), so a die
			// that has been rolled and consumed simply leaves its slot empty.
			const slot = diceSlotById.get(die.id) ?? 0;
			const { cx, cy } = matchDieCenter(slot, slotTotal, mid, uHat, vHat);
			const wrap = new Container();
			wrap.position.set(cx, cy);

			// A soft ring under a die the player has picked for this roll. The die stays in
			// the grid while selected and only leaves once the Roll consumes it.
			if (side.interactive && dicePick.includes(die.id)) {
				const ring = new Graphics()
					.ellipse(0, MATCH_DIE_SIZE * 0.2, MATCH_DIE_SIZE * 0.72, MATCH_DIE_SIZE * 0.44)
					.fill({ color: 0xffdd33, alpha: 0.35 })
					.stroke({ width: 3, color: 0xffdd33 });
				ring.eventMode = 'none';
				wrap.addChild(ring);
			}

			const cube = buildStaticDie(pixi, {
				topTexture: texByKey.get(`${die.id}-${f.top}`) ?? null,
				leftTexture: texByKey.get(`${die.id}-${f.left}`) ?? null,
				rightTexture: texByKey.get(`${die.id}-${f.right}`) ?? null,
				color: side.color,
				size: MATCH_DIE_SIZE
			});
			wrap.addChild(cube);

			// Remember this side's cube (in its own node map) so its turn-start roll can tumble the
			// cube in place before it leaves the pool (the animation transforms the cube, leaving
			// its wrap/ring put).
			(side.interactive ? diceNodeById : rivalDiceNodeById).set(die.id, cube);

			// Only the player's dice, and only while the pick is open, take clicks.
			if (side.interactive && pickingDice) {
				wrap.eventMode = 'static';
				wrap.cursor = 'pointer';
				wrap.on('pointertap', () => toggleDicePick(die.id));
			}

			built.push({ node: wrap, cy });
		});

		built
			.sort((a, b) => a.cy - b.cy)
			.forEach(({ node }) => diceDisplayLayer!.addChild(node));

		// The player's Roll button, one row past the block while the pick is open.
		if (side.interactive && pickingDice) {
			const rows = Math.max(1, Math.ceil(slotTotal / MATCH_DIE_COLS));
			const out = MATCH_DIE_OUT_GAP + rows * MATCH_DIE_ROW_STEP + MATCH_DIE_ROW_STEP;
			const enabled = dicePick.length === dicePickCount();
			const btn = buildActionButton(
				`Roll ${dicePick.length}/${dicePickCount()}`,
				enabled ? 'primary' : 'neutral',
				enabled,
				rollDicePick
			);
			btn.position.set(mid.x + vHat.x * out - ACTION_BTN_W / 2, mid.y + vHat.y * out);
			diceDisplayLayer.addChild(btn);
		}
	}

	// Each side's parked roll-spot dice: the cubes it just rolled, seated in a row at that side's
	// roll spot past its block and kept there until its next roll. A passive display (no ring, not
	// clickable), drawn back-to-front so nearer cubes overlap the ones behind them.
	for (const side of sides) {
		const parked: { node: Container; cy: number }[] = [];
		side.parked.forEach((die, i) => {
			const f = dieCubeFaces(die);
			const { x, y } = rolledDieCenter(i, side.parked.length, side.axes);
			const wrap = new Container();
			wrap.position.set(x, y);
			wrap.addChild(
				buildStaticDie(pixi, {
					topTexture: texByKey.get(`${die.id}-${f.top}`) ?? null,
					leftTexture: texByKey.get(`${die.id}-${f.left}`) ?? null,
					rightTexture: texByKey.get(`${die.id}-${f.right}`) ?? null,
					color: side.color,
					size: MATCH_DIE_SIZE
				})
			);
			parked.push({ node: wrap, cy: y });
		});
		parked.sort((a, b) => a.cy - b.cy).forEach(({ node }) => diceDisplayLayer!.addChild(node));
	}

	// Each side's three role-energy counters, laid out as an extra pool column past the block's
	// last one: each role's face icon with that side's running energy total stacked beneath it.
	// Always drawn (a fresh match reads 0 on each) once the config's role icons are known.
	if (diceConfig) {
		for (const side of sides) {
			ENERGY_ROWS.forEach(({ role }, k) => {
				const url = diceConfig!.roles[role]?.icon;
				const tex = url ? (iconTexByUrl.get(url) ?? null) : null;
				const { x, y } = roleCounterCenter(k, side.axes);
				const counter = buildRoleCounter(tex, side.energyPool[role]);
				counter.position.set(x, y);
				diceDisplayLayer!.addChild(counter);
			});
		}
	}
}

// Repaint the dice display whenever either pool changes (a roll consumed dice), the pick
// phase opens or closes, the player's selection changes (to re-draw the rings and the Roll
// button's count), either side's parked roll-spot dice appear/clear, the config's role icons
// land, or either side's energy totals change (the role counters beside each block track them).
// Guarded until the layer exists (init triggers the first render).
$effect(() => {
	void playerDice;
	void rivalDice;
	void pickingDice;
	void dicePick;
	void rolledTurnDice;
	void rivalRolledTurnDice;
	void diceConfig;
	void energy.summon;
	void energy.move;
	void energy.attack;
	void cpuEnergy.summon;
	void cpuEnergy.move;
	void cpuEnergy.attack;
	renderDiceDisplay();
});

// Every corner of a side's upright hand row, laid out at full HAND_SIZE, so the bounds
// reserve room for a full hand even before any card is drawn or spent. Reproduces the
// layout renderHand / renderCpuHand use: cards stepped along the plaque's outer edge
// (from diceBlockAxes) and pushed one HAND_OUT_GAP outward, each card's top-left riding
// that anchor line with its HAND_CARD_W × HAND_CARD_H body hanging off it. `lift` matches
// the rival's upward shift (a full card height) that stands its backs above the line;
// the player passes 0.
function handCardCorners(matrix: Matrix, lift: number): { x: number; y: number }[] {
	const { uHat, vHat, mid } = diceBlockAxes(matrix);
	const edgeSlope = uHat.y / uHat.x;
	const anchorX = mid.x + vHat.x * HAND_OUT_GAP;
	const anchorY = mid.y + vHat.y * HAND_OUT_GAP - lift;
	const step = HAND_CARD_W + HAND_CARD_GAP;
	const startX = anchorX - ((HAND_SIZE - 1) * step) / 2 - HAND_CARD_W / 2;

	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i < HAND_SIZE; i++) {
		const x = startX + i * step;
		const y = anchorY + edgeSlope * (x - anchorX);
		pts.push(
			{ x, y },
			{ x: x + HAND_CARD_W, y },
			{ x: x + HAND_CARD_W, y: y + HAND_CARD_H },
			{ x, y: y + HAND_CARD_H }
		);
	}
	return pts;
}

// Every world-space point the play area must enclose: the isometric grid, both card
// plaques flanking it at opposite corners, — reserved at full size — each side's
// match-dice block laid past its plaque, and each side's full-size hand row. Shared by
// frameBoard (the opening camera fit) and drawBoardFrame (the yellow reference outline)
// so both bound the same region and neither the dice nor the hands fall outside the
// framed view.
function playAreaPoints(): { x: number; y: number }[] {
	const pts: { x: number; y: number }[] = [];

	// The grid's bounding box: half a tile out from the extreme corner cells. The
	// widest cells sit at (0, GRID_HEIGHT-1) / (GRID_WIDTH-1, 0); the top-most is
	// (0,0) and the bottom-most is (GRID_WIDTH-1, GRID_HEIGHT-1).
	pts.push(
		{ x: isoPosOf(0, GRID_HEIGHT - 1).x - TILE_WIDTH / 2, y: isoPosOf(0, 0).y - TILE_HEIGHT / 2 },
		{
			x: isoPosOf(GRID_WIDTH - 1, 0).x + TILE_WIDTH / 2,
			y: isoPosOf(GRID_WIDTH - 1, GRID_HEIGHT - 1).y + TILE_HEIGHT / 2
		}
	);

	// Each plaque's local rectangle (0..TAG_WIDTH, 0..TAG_HEIGHT) projected onto the
	// ground plane by its board matrix, so the bounds reach out past both corners.
	for (const m of [PLAYER_BOARD_MATRIX, RIVAL_BOARD_MATRIX]) {
		for (const [lx, ly] of [
			[0, 0],
			[TAG_WIDTH, 0],
			[TAG_WIDTH, TAG_HEIGHT],
			[0, TAG_HEIGHT]
		]) {
			pts.push(m.apply({ x: lx, y: ly }));
		}
	}

	// Each side's dice block at full size (MATCH_DICE_MAX_ROWS rows) plus its roll spot and its
	// role-counter column, so the frame and the opening zoom always leave room for the whole pool
	// (and the parked dice / counters beside it) even before any die is consumed. Both sides now
	// lay out from their own grid-border axes, at opposite ends of the board.
	const fullCount = MATCH_DIE_COLS * MATCH_DICE_MAX_ROWS;
	for (const { uHat, vHat, mid } of [playerDiceAxes(), rivalDiceAxes()]) {
		for (let k = 0; k < fullCount; k++) {
			const { cx, cy } = matchDieCenter(k, fullCount, mid, uHat, vHat);
			pts.push({ x: cx - MATCH_DIE_SIZE, y: cy - MATCH_DIE_SIZE });
			pts.push({ x: cx + MATCH_DIE_SIZE, y: cy + MATCH_DIE_SIZE });
		}
		// The Roll button (and, after a roll, the parked dice) hang one row past the block; keep
		// their reach in bounds too.
		const out = MATCH_DIE_OUT_GAP + (MATCH_DICE_MAX_ROWS + 1) * MATCH_DIE_ROW_STEP;
		pts.push({ x: mid.x + vHat.x * out, y: mid.y + vHat.y * out + ACTION_BTN_H });

		// The role-counter column sits one column past the block's last column, stepped down its
		// depth rows; keep that extra column's reach in bounds so the opening zoom leaves room.
		const along = (MATCH_DIE_COLS - (MATCH_DIE_COLS - 1) / 2) * MATCH_DIE_COL_STEP;
		const counterOut =
			MATCH_DIE_OUT_GAP + (MATCH_DICE_MAX_ROWS - 1) * MATCH_DIE_ROW_STEP + MATCH_DIE_SIZE / 2;
		pts.push({
			x: mid.x + uHat.x * along + vHat.x * counterOut + MATCH_DIE_SIZE,
			y: mid.y + uHat.y * along + vHat.y * counterOut + MATCH_DIE_SIZE
		});
	}

	// Each side's full-size hand row: the player's cards hang down-right off the plaque
	// edge (no lift), the rival's stand up-left above it (lifted a full card height), the
	// same shifts renderHand / renderCpuHand apply. Adding both keeps the whole hand inside
	// the framed view instead of overflowing the yellow outline below and above it.
	pts.push(...handCardCorners(PLAYER_BOARD_MATRIX, 0));
	pts.push(...handCardCorners(RIVAL_BOARD_MATRIX, HAND_CARD_H));

	return pts;
}

// Frame the whole play area (grid + plaques + dice blocks) into the horizontal gap the
// left panel leaves free, centered in that gap and vertically in the canvas. Called
// once the board is built so the match opens looking at the play area — and, because the
// dice blocks are part of the bounds, so both sides' dice sit on-screen rather than
// spilling past the framed corners.
function frameBoard() {
	const pts = playAreaPoints();
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const boxW = Math.max(1, maxX - minX);
	const boxH = Math.max(1, maxY - minY);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;

	// The canvas already ends at the right column's left edge (the viewport reserves
	// --right-col-w on the right), so only the left dice panel — which floats over the
	// canvas at top-left — is subtracted here. Its offsetWidth includes padding; falls
	// back to the full canvas before it's measured.
	const leftW = leftPanel?.offsetWidth ?? 0;
	const availableW = Math.max(1, app.screen.width - leftW);

	// Fit the play area into the free gap by whichever axis is the tighter constraint,
	// a small margin keeping its edges off the panels.
	const MARGIN = 0.94;
	const scale = Math.max(
		MIN_ZOOM,
		Math.min(MAX_ZOOM, (availableW / boxW) * MARGIN, (app.screen.height / boxH) * MARGIN)
	);
	camera.scale.set(scale);

	// Center the play area's bounding box in the free gap horizontally and on the canvas
	// midline vertically.
	camera.x = leftW + availableW / 2 - centerX * scale;
	camera.y = app.screen.height / 2 - centerY * scale;
}

// A yellow reference outline framing the whole play area: the isometric grid, the red
// (player) and blue (rival) card plaques flanking it at opposite corners, and each
// side's match-dice block past its plaque. Lives inside `camera`, so it pans and zooms
// with the board. Purely a visual guide.
let boardFrame: Graphics | undefined;

// Whether the yellow outline is shown. Driven by the page's top-left panel toggle:
// drawBoardFrame honors it when (re)building the outline, and toggleBoardFrame flips
// the live graphic in place. $state so the panel's toggle reflects the current value.
let boardFrameVisible = $state(true);
function toggleBoardFrame() {
	boardFrameVisible = !boardFrameVisible;
	if (boardFrame) boardFrame.visible = boardFrameVisible;
}

function drawBoardFrame() {
	if (!camera) return;

	const pts = playAreaPoints();
	const xs = pts.map((p) => p.x);
	const ys = pts.map((p) => p.y);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);

	boardFrame?.destroy();
	boardFrame = new Graphics()
		.rect(minX, minY, maxX - minX, maxY - minY)
		.stroke({ width: 3, color: 0xffff00 });
	boardFrame.eventMode = 'none';
	boardFrame.visible = boardFrameVisible;
	camera.addChild(boardFrame);
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

// Per-card board customizations authored in the /cards board-preview modal
// and baked into the catalog, applied here so a creature renders on the board
// exactly as it previews there. `sizeOf` is the billboard scale multiplier (1 =
// default), and `offsetOf` is its x/y nudge (in world px) from the cell center.
function sizeOf(creature: IGameCreature): number {
	return creature.size && creature.size > 0 ? creature.size : 1;
}
function offsetOf(creature: IGameCreature): { x: number; y: number } {
	// The authored offset was calibrated against a full TILE_WIDTH cell in the
	// /cards preview. The board's cells (and the purple reference square) are
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
// square in the /cards board-preview modal: an axis-aligned square whose
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

// Current orientation of the dice net, in 90° clockwise steps (0..3). Rotated
// with the mouse wheel while a creature is selected for summoning.
let netRotation = 0;
// Which of the 11 unique cube nets (see DICE_NETS) the player's summons and Unfold
// actions currently lay. The default (index 0) is the classic cross/T net; the
// in-canvas net picker sets this for the current and every following net action.
let activeNetIndex = $state(0);
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

// The active dice net's offsets rotated by the current player orientation.
function rotatedOffsets(): Array<[number, number]> {
	return offsetsForRotation(netRotation, DICE_NETS[activeNetIndex]);
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
	// board preview in /cards 1:1.
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
	// border in the /cards board-preview modal so a creature looks on the
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
		// While picking Fusion / Ritual sacrifices, a click toggles this creature in
		// or out of the material selection instead of inspecting it.
		if (specialPhase === 'materials') {
			toggleMaterial(unit);
			return;
		}
		if (moving || combating) return;
		inspectedUnit = unit;
		inspectedCreature = creature;
		inspectedIsPlayer = unit.side === 'player';
		// Precompute whether this unit has a rival target in range so the Combat
		// button can reflect it (inspectedUnit isn't reactive on its own).
		inspectedCanCombat = unit.side === 'player' && combatTargetsFor(unit).length > 0;
	});

	// Hovering an on-board creature shows its card in the bottom-left DOM viewer, and —
	// for the player's own units — unfolds the Move / Combat action buttons beneath it
	// (the group's own hover handlers keep them open once the pointer slides onto them).
	// Leaving folds the buttons back; the viewer keeps the card until another is hovered.
	sprite.on('pointerenter', () => {
		showCardPreview(creature.id, unit.unitId);
		if (unit.side === 'player' && !moving && !combating) hoveredActionUnitId = unit.unitId;
	});
	sprite.on('pointerleave', () => {
		if (hoveredActionUnitId === unit.unitId) hoveredActionUnitId = null;
	});

	placedUnits.set(unit.unitId, unit);

	// Give the unit its (hidden) on-board action buttons, pinned beneath the sprite.
	ensureActionGroup(unit);

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

// --- Special (Fusion / Ritual) summon ---------------------------------------

// Tint painted on a creature chosen as a sacrifice while picking materials, and
// the fill color of the highlight laid over each legal special-summon tile.
const SPECIAL_MATERIAL_TINT = 0x66ff66;
const SPECIAL_PLACE_COLOR = 0xffcc33;

// Begin a Fusion / Ritual summon: enter material-selection mode where the player
// clicks their own on-board creatures to pick the sacrifices. Ignored when another
// action is in flight, when the summon isn't currently possible, or while the
// rival is acting.
function beginSpecialSummon(card: IGameCreature) {
	if (gameOver || rivalThinking || summoning || moving || combating || unfolding) return;
	if (selectedMonster || specialPhase) return;
	if (!canSpecialSummon(card)) return;

	specialCard = card;
	specialMaterials = [];
	specialReady = false;
	specialPhase = 'materials';

	// A hand card can't double as a normal summon while a special one is staged.
	selectedMonster = null;

	enterMaterialFocus();
	refreshMaterialHighlight();
	updateSpecialPrompt();
}

// Dim the creatures that can't be sacrificed for the staged special summon (rival
// units, and — for a Fusion — creatures matching neither its attribute nor its
// type) and drop their interactivity, leaving the eligible player creatures bright
// and clickable.
function enterMaterialFocus() {
	for (const unit of placedUnits.values()) {
		const eligible =
			!!specialCard && unit.side === 'player' && eligibleMaterial(specialCard, unit);
		unit.sprite.alpha = eligible ? 1 : 0.4;
		unit.sprite.eventMode = eligible ? 'static' : 'none';
	}
}

// Repaint the sacrifice highlight: chosen materials tint green, everything else
// clears back to its normal color.
function refreshMaterialHighlight() {
	for (const unit of placedUnits.values()) {
		unit.sprite.tint = specialMaterials.includes(unit) ? SPECIAL_MATERIAL_TINT : 0xffffff;
	}
}

// Update the on-canvas instruction for the staged special summon to reflect the
// phase and how far the current selection is from satisfying the condition.
function updateSpecialPrompt() {
	if (!specialCard) {
		specialPrompt = '';
		return;
	}
	if (specialPhase === 'placing') {
		specialPrompt = `Place ${specialCard.name} on one of your tiles`;
		return;
	}
	if (isFusion(specialCard)) {
		specialPrompt = `Fusion: sacrifice a ${specialCard.attribute} creature + a ${specialCard.race} creature (${specialMaterials.length}/2)`;
	} else {
		const have = specialMaterials.reduce((sum, u) => sum + u.creature.cost, 0);
		specialPrompt = `Ritual: sacrifice creatures with total cost ≥ ${specialCard.cost} (have ${have})`;
	}
}

// Toggle a clicked creature in/out of the sacrifice selection. A Fusion keeps at
// most two picks (a third click drops the oldest), trending toward a legal pair; a
// Ritual accumulates freely until the cost is met.
function toggleMaterial(unit: PlacedUnit) {
	if (!specialCard || specialPhase !== 'materials') return;
	if (unit.side !== 'player' || !eligibleMaterial(specialCard, unit)) return;

	const i = specialMaterials.indexOf(unit);
	if (i >= 0) {
		specialMaterials.splice(i, 1);
	} else {
		if (isFusion(specialCard) && specialMaterials.length >= 2) specialMaterials.shift();
		specialMaterials.push(unit);
	}

	specialReady = materialsSatisfy(specialCard, specialMaterials);

	// The moment the selection satisfies the summon condition, advance straight to
	// placement — no explicit Confirm step.
	if (specialReady) {
		confirmSpecialMaterials();
		return;
	}

	refreshMaterialHighlight();
	updateSpecialPrompt();
}

// The player's red tiles a special monster may be dropped onto: painted red cells
// that aren't an origin and hold no creature (the freed sacrifice cells always
// qualify, so a legal tile always exists once the materials are gone).
function specialPlacementTiles(): string[] {
	const keys: string[] = [];
	for (const [key, color] of occupied) {
		if (color !== CELL_RED) continue;
		const [x, y] = key.split(',').map(Number);
		if (isOriginCell(x, y)) continue;
		if (unitAt(x, y)) continue;
		keys.push(key);
	}
	return keys;
}

function isSpecialPlacementTile(x: number, y: number): boolean {
	return occupied.get(tileKey(x, y)) === CELL_RED && !isOriginCell(x, y) && !unitAt(x, y);
}

// Commit the chosen sacrifices: destroy them as if they fell in combat, then move
// to placement mode — dim the board, drop unit interactivity so the tiles beneath
// are clickable, and highlight every legal destination.
function confirmSpecialMaterials() {
	if (!specialCard || specialPhase !== 'materials' || !specialReady) return;

	const mats = [...specialMaterials];
	specialMaterials = [];
	for (const unit of mats) removeUnit(unit);

	specialPhase = 'placing';

	for (const unit of placedUnits.values()) unit.sprite.alpha = 0.5;
	disableUnitInteractivity();

	for (const child of moveOverlay.removeChildren()) child.destroy();
	for (const key of specialPlacementTiles()) {
		const [x, y] = key.split(',').map(Number);
		const { x: isoX, y: isoY } = isoPosOf(x, y);
		const overlay = drawCellDiamond(new Graphics()).fill({
			color: SPECIAL_PLACE_COLOR,
			alpha: 0.55
		});
		overlay.position.set(isoX, isoY);
		moveOverlay.addChild(overlay);
	}

	updateSpecialPrompt();
}

// Restore every creature's opacity/interactivity and drop the placement
// highlights once the special summon ends (placed or canceled).
function exitSpecialFocus() {
	for (const unit of placedUnits.values()) {
		unit.sprite.alpha = 1;
		unit.sprite.tint = 0xffffff;
	}
	restoreUnitInteractivity();
	for (const child of moveOverlay.removeChildren()) child.destroy();
}

// Drop the special monster onto a chosen red tile. It stands on existing floor, so
// the placement net (just the crossroads) lays no new ground — the monster doesn't
// unfold — and no energy is paid. Otherwise it's a regular creature (rolls its HP).
async function placeSpecial(x: number, y: number) {
	if (!specialCard || specialPhase !== 'placing') return;
	if (!isSpecialPlacementTile(x, y)) return;

	const card = specialCard;

	exitSpecialFocus();
	specialPhase = null;
	specialCard = null;
	specialReady = false;
	specialPrompt = '';

	// The card leaves the hand and joins the played plaque, like a normal summon.
	hand = hand.filter((c) => c.id !== card.id);
	playedCards = [...playedCards, card];

	summoning = true;
	try {
		const unit = await placeMonster(card, x, y, 'player', CELL_RED, [[0, 0]]);

		// Re-point the detail panel at the freshly placed unit, as a normal summon does.
		if (unit) {
			inspectedUnit = unit;
			inspectedCreature = unit.creature;
			inspectedIsPlayer = true;
			inspectedCanCombat = combatTargetsFor(unit).length > 0;
		}
	} finally {
		summoning = false;
	}
}

// Abandon a staged special summon. Only possible during material selection — once
// the sacrifices are destroyed (placing phase) the summon has to be completed.
function cancelSpecialSummon() {
	if (specialPhase !== 'materials') return;
	specialMaterials = [];
	specialCard = null;
	specialPhase = null;
	specialReady = false;
	specialPrompt = '';
	exitSpecialFocus();
}

// Enter move mode for a unit (fired by its on-board Move button): highlight every
// reachable painted tile and keep this unit the action focus until the move completes
// or is canceled.
function startMove(unit: PlacedUnit) {
	// Only the player's own units can be moved by hand.
	if (!unit || unit.side !== 'player') return;

	// No more actions once the match is decided.
	if (gameOver) return;

	// Not enough move energy to pay the creature's cost: can't move.
	if (energy.move < unit.creature.cost) return;

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
	// The pointer is off on a destination tile now, not the creature, so drop the
	// hover focus — the action buttons reappear only when a creature is hovered again.
	hoveredActionUnitId = null;
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

	// Keep the shadow, cell square, HP bar and action buttons aligned with the sprite's
	// new tile.
	positionShadow(unit);
	positionCellSquare(unit);
	positionHealthBar(unit);
	positionUnitActions(unit);
}

// Finish the player's move: relocate the sprite, update the unit's grid position
// and charge the creature's cost to the energy pool.
function completeMove(x: number, y: number) {
	const unit = movingUnit;
	if (!unit) return;

	restoreMoveHighlight();
	exitMoveFocus();

	relocateUnit(unit, x, y);

	energy.move -= unit.creature.cost;

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

// Enter combat mode for a unit (fired by its on-board Combat button): highlight every
// rival target in range and keep this attacker the action focus until combat resolves
// or is canceled.
function startCombat(unit: PlacedUnit) {
	// Only the player's own units can attack by hand.
	if (!unit || unit.side !== 'player') return;

	// No more actions once the match is decided.
	if (gameOver) return;

	// Not enough attack energy to pay the creature's cost: can't attack.
	if (energy.attack < unit.creature.cost) return;

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
	// Drop the hover focus — the pointer left the attacker to pick a target, so the
	// buttons should reappear only on a fresh hover.
	hoveredActionUnitId = null;
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
	unit.actionGroup?.destroy();
	if (hoveredActionUnitId === unit.unitId) hoveredActionUnitId = null;
	// The viewer keeps showing this creature's card (it holds the last card hovered), but a
	// destroyed unit can no longer act — drop its actions so the viewer's buttons go with it.
	if (previewUnitId === unit.unitId) previewUnitId = null;
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
		// Pay the combat cost out of the attack energy pool.
		energy.attack -= attacker.creature.cost;

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

// A rough board value of a creature, used to keep the rival from sacrificing more
// than it gains on a special summon (same weighting the summon scorer uses).
function creatureValue(c: IGameCreature): number {
	return c.atk + c.hp + c.speed + c.reach;
}

// A planned rival special summon: the card, the sacrifices to spend, and the blue
// tile to drop it on afterwards.
interface CpuSpecialPlan {
	card: IGameCreature;
	materials: PlacedUnit[];
	x: number;
	y: number;
}

// The blue tiles the rival could drop a special monster on once `materials` are
// gone: a painted blue cell that isn't an origin and is either empty or held by
// one of the about-to-be-sacrificed materials. Nearest the player origin first, so
// a fresh special monster lands as far forward as it can.
function cpuSpecialPlacement(materials: PlacedUnit[]): { x: number; y: number } | null {
	const freed = new Set(materials.map((u) => tileKey(u.x, u.y)));
	let best: { x: number; y: number } | null = null;
	let bestDist = Number.POSITIVE_INFINITY;

	for (const [key, color] of occupied) {
		if (color !== CELL_BLUE) continue;
		const [x, y] = key.split(',').map(Number);
		if (isOriginCell(x, y)) continue;
		const occupant = unitAt(x, y);
		if (occupant && !freed.has(key)) continue;

		const dist = distanceToTargetOrigin(x, y);
		if (dist < bestDist) {
			bestDist = dist;
			best = { x, y };
		}
	}

	return best;
}

// Try to assemble the cheapest legal set of sacrifices from the rival's own units
// for a special summon. Fusion: the lowest-value creature matching the attribute
// plus a different lowest-value one matching the type. Ritual: the cheapest units
// until their combined cost meets the ritual's. Null when the board can't pay it.
function assembleCpuMaterials(card: IGameCreature): PlacedUnit[] | null {
	const mine = unitsOf('cpu').sort((a, b) => creatureValue(a.creature) - creatureValue(b.creature));

	if (isFusion(card)) {
		const attrUnits = mine.filter((u) => u.creature.attribute === card.attribute);
		const typeUnits = mine.filter((u) => u.creature.race === card.race);
		for (const a of attrUnits) {
			const t = typeUnits.find((u) => u !== a);
			if (t) return [a, t];
		}
		return null;
	}

	const chosen: PlacedUnit[] = [];
	let total = 0;
	for (const unit of mine) {
		chosen.push(unit);
		total += unit.creature.cost;
		if (total >= card.cost) return chosen;
	}
	return null;
}

// The rival's best available special summon this turn, or null when none is worth
// it. A summon is only taken when the summoned creature is worth at least as much
// as everything sacrificed for it, so the rival never trades down.
function bestCpuSpecialSummon(): CpuSpecialPlan | null {
	let best: CpuSpecialPlan | null = null;
	let bestGain = 0;

	for (const card of cpuHand) {
		if (!isSpecialSummon(card)) continue;

		const materials = assembleCpuMaterials(card);
		if (!materials) continue;

		const spent = materials.reduce((sum, u) => sum + creatureValue(u.creature), 0);
		const gain = creatureValue(card) - spent;
		if (gain < 0) continue;

		const spot = cpuSpecialPlacement(materials);
		if (!spot) continue;

		if (gain >= bestGain) {
			bestGain = gain;
			best = { card, materials, x: spot.x, y: spot.y };
		}
	}

	return best;
}

// Play out the rival's special (Fusion / Ritual) summons at the start of its turn:
// repeatedly take the best worthwhile one — sacrificing its materials, then
// dropping the monster on a blue tile with no net and no energy — until none
// remains. Capped so it can't loop forever.
async function runCpuSpecialSummons() {
	for (let i = 0; i < 4; i++) {
		if (gameOver) break;

		const plan = bestCpuSpecialSummon();
		if (!plan) break;

		for (const unit of plan.materials) removeUnit(unit);
		await placeMonster(plan.card, plan.x, plan.y, 'cpu', CELL_BLUE, [[0, 0]]);
		cpuHand = cpuHand.filter((c) => c.id !== plan.card.id);
		cpuPlayedCards = [...cpuPlayedCards, plan.card];

		await new Promise((resolve) => setTimeout(resolve, 400));
	}
}

// Every valid move available to the rival given its current energy: affordable,
// unplaced creatures at any tile/rotation that extends the blue network, plus
// relocations of its placed units onto any reachable painted tile.
function enumerateCpuMoves(): CpuMove[] {
	const moves: CpuMove[] = [];

	for (const creature of cpuHand) {
		// Fusion / Ritual cards are never net-summoned; they're special-summoned by
		// sacrificing on-board creatures in a separate step (see runCpuSpecialSummons).
		if (isSpecialSummon(creature)) continue;
		// Summoning is paid from the rival's summon pool.
		if (creature.cost > cpuEnergy.summon) continue;

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

		// Moving is paid from the move pool; attacking from the attack pool — each
		// action is only enumerated when its own pool can cover the creature's cost.
		if (unit.creature.cost <= cpuEnergy.move) {
			for (const key of moveTargetsFor(unit)) {
				const [x, y] = key.split(',').map(Number);
				moves.push({ type: 'move', creature: unit.creature, x, y, cost: unit.creature.cost, unit });
			}
		}

		// Attacks on player creatures / the player's origin within this unit's reach.
		if (unit.creature.cost <= cpuEnergy.attack) {
			for (const key of combatTargetsFor(unit)) {
				const [x, y] = key.split(',').map(Number);
				moves.push({ type: 'combat', creature: unit.creature, x, y, cost: unit.creature.cost, unit });
			}
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

		// Before spending energy, play any worthwhile Fusion / Ritual summons: these
		// cost no energy, only on-board sacrifices, so they develop the board first and
		// the freshly summoned creatures can then move and attack in the loop below.
		await runCpuSpecialSummons();

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

			// Spend the cost from the pool matching the action: summons from `summon`,
			// relocations from `move`, attacks from `attack`.
			const pool: DiceRole = move.type === 'summon' ? 'summon' : move.type === 'move' ? 'move' : 'attack';
			cpuEnergy[pool] -= move.cost;

			// Pace the actions so the player can watch the rival move one at a time.
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
	} finally {
		rivalThinking = false;
		// The rival's turn is over — clear its parked roll-spot dice, the mirror of endTurn
		// dropping the player's `rolledTurnDice` when the player's turn ends.
		rivalRolledTurnDice = [];
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
	if (energy.summon < UNFOLD_COST) return;

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

// --- In-canvas dice-net picker ------------------------------------------------
// A right-triangle panel tucked under the grid's south-west edge: its hypotenuse runs
// along that edge from the grid's leftmost point to its bottommost point, and the right
// angle sits at the bottom-left corner of the board's bounding box. It shows all 11
// unique ways a d6 unfolds; clicking one makes that net the shape every following
// summon / Unfold lays. Only visible while the player is choosing a placement (a
// creature selected, or Unfold mode). It lives in `camera`, so it stays glued to those
// grid corners as the board pans and zooms.
let netPanel: Container | undefined;
type NetThumb = { container: Container; bg: Graphics; glyph: Graphics; index: number };
let netThumbs: NetThumb[] = [];

// Inset from the triangle's edges, and how many thumbnails sit in each row from top to
// bottom — rows widen toward the bottom to match the triangle (1 + 2 + 3 + 5 = 11). The
// left leg and bottom leg use half the margin so the thumbnails hug the right-angle
// corner, while the top vertex and the hypotenuse keep the fuller inset.
const NET_PANEL_MARGIN = 16;
const NET_PANEL_MARGIN_LEFT = NET_PANEL_MARGIN / 2;
const NET_PANEL_MARGIN_BOTTOM = NET_PANEL_MARGIN / 2;
const NET_PANEL_ROWS = [1, 2, 3, 5];
const NET_THUMB_SIZE = 34;

// Build the picker once: the translucent triangle backdrop plus the 11 net thumbnails,
// laid into rows centered between the left leg and the hypotenuse at each row's height.
function buildNetPanel() {
	if (!camera) return;

	const panel = new Container();
	// 'passive' so the layer itself isn't hit-tested but its thumbnail children still
	// receive clicks (the same treatment the hand and action layers use).
	panel.eventMode = 'passive';
	panel.visible = false;

	// The triangle's three corners in world space. The grid's leftmost / bottommost
	// diamond vertices are a half-tile out from those corner cells' centers; the right
	// angle is the bottom-left of the board's bounding box.
	const left = {
		x: isoPosOf(0, GRID_HEIGHT - 1).x - TILE_WIDTH / 2,
		y: isoPosOf(0, GRID_HEIGHT - 1).y
	};
	const bottom = {
		x: isoPosOf(GRID_WIDTH - 1, GRID_HEIGHT - 1).x,
		y: isoPosOf(GRID_WIDTH - 1, GRID_HEIGHT - 1).y + TILE_HEIGHT / 2
	};
	const corner = { x: left.x, y: bottom.y };

	// Filled triangle with a faint red edge, matching the player's red network.
	const bg = new Graphics();
	bg.moveTo(corner.x, corner.y).lineTo(left.x, left.y).lineTo(bottom.x, bottom.y).closePath();
	bg.fill({ color: 0x000000, alpha: 0.55 }).stroke({ width: 1.5, color: CELL_RED, alpha: 0.7 });
	bg.eventMode = 'none';
	panel.addChild(bg);

	// A thumbnail is a square, so keeping its whole box inside the triangle — not just
	// its center — is what stops it poking past the diagonal. The binding corner is the
	// top-right one (largest x, smallest y): the hypotenuse is furthest left there, so
	// the right bound is measured at the thumbnail's top edge, inset by a half-size.
	const half = NET_THUMB_SIZE / 2;
	const slope = (bottom.x - left.x) / (bottom.y - left.y);
	const hypX = (y: number) => left.x + (y - left.y) * slope;

	// The left edge of every row: hard against the vertical leg (plus its margin).
	const rowLeftCenter = corner.x + NET_PANEL_MARGIN_LEFT + half;
	// The rightmost a thumbnail's center may sit at a given row height and still keep its
	// top-right corner off the hypotenuse.
	const rowRightCenter = (cy: number) => hypX(cy - half) - NET_PANEL_MARGIN - half;

	// Row heights. The top row must drop low enough that even a single thumbnail clears
	// the narrow apex (where rowRightCenter first reaches rowLeftCenter); the bottom row's
	// lower edge must clear the bottom leg. Rows are then spread evenly between the two.
	const cyBottom = bottom.y - NET_PANEL_MARGIN_BOTTOM - half;
	const cyTop = left.y + half + (rowLeftCenter - left.x + NET_PANEL_MARGIN + half) / slope;
	const rowStep = NET_PANEL_ROWS.length > 1 ? (cyBottom - cyTop) / (NET_PANEL_ROWS.length - 1) : 0;

	// Shared column grid: the widest (bottom) row spans the left leg to the hypotenuse and
	// fixes the x of every column, so upper rows drop into the same columns and line up
	// vertically instead of each row spreading on its own. Upper rows are narrower, so they
	// only fill the leftmost columns — which are the ones that clear the hypotenuse there.
	const maxCount = Math.max(...NET_PANEL_ROWS);
	const colStep = maxCount > 1 ? (rowRightCenter(cyBottom) - rowLeftCenter) / (maxCount - 1) : 0;

	netThumbs = [];
	let index = 0;
	NET_PANEL_ROWS.forEach((count, row) => {
		const cy = cyTop + rowStep * row;

		for (let k = 0; k < count && index < DICE_NETS.length; k++, index++) {
			const thumb = buildNetThumb(index, rowLeftCenter + colStep * k, cy);
			netThumbs.push(thumb);
			panel.addChild(thumb.container);
		}
	});

	netPanel = panel;
	camera.addChild(panel);
	paintNetPanel();
}

// A single clickable thumbnail: a rounded background plus the net's glyph, selecting
// its net on tap.
function buildNetThumb(index: number, cx: number, cy: number): NetThumb {
	const container = new Container();
	container.position.set(cx, cy);
	container.eventMode = 'static';
	container.cursor = 'pointer';

	const bg = new Graphics();
	const glyph = new Graphics();
	glyph.eventMode = 'none';
	container.addChild(bg);
	container.addChild(glyph);

	container.on('pointertap', () => selectNet(index));

	return { container, bg, glyph, index };
}

// Adopt a net as the active one and re-light the picker, then refresh the live hover
// preview so the new shape appears immediately under the pointer.
function selectNet(index: number) {
	if (index === activeNetIndex) return;
	activeNetIndex = index;
	paintNetPanel();

	if (hoverTile) {
		if (selectedMonster?.billboard) showPreview(selectedMonster.billboard, hoverTile.x, hoverTile.y);
		else if (unfolding) showNetPreview(hoverTile.x, hoverTile.y);
	}
}

// (Re)draw every thumbnail so the active net reads red and lit while the rest stay gray.
function paintNetPanel() {
	const half = NET_THUMB_SIZE / 2;

	for (const thumb of netThumbs) {
		const active = thumb.index === activeNetIndex;

		thumb.bg.clear();
		thumb.bg
			.roundRect(-half, -half, NET_THUMB_SIZE, NET_THUMB_SIZE, 5)
			.fill({ color: active ? 0x3a1213 : 0x141414, alpha: 0.95 })
			.stroke({
				width: active ? 1.5 : 1,
				color: active ? CELL_RED : 0x555555,
				alpha: active ? 1 : 0.8
			});

		drawNetGlyph(thumb.glyph, DICE_NETS[thumb.index], active);
	}
}

// Draw a net's six cells as flat squares centered in a thumbnail, scaled to fit its
// bounding box. The crossroads cell (0, 0) is drawn a touch brighter so the shape's
// anchor reads.
function drawNetGlyph(g: Graphics, net: Array<[number, number]>, active: boolean) {
	g.clear();

	const xs = net.map(([dx]) => dx);
	const ys = net.map(([, dy]) => dy);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const cols = Math.max(...xs) - minX + 1;
	const rows = Math.max(...ys) - minY + 1;

	const cell = (NET_THUMB_SIZE * 0.78) / Math.max(cols, rows);
	// Center the polyomino's bounding box on the thumbnail's origin.
	const originX = -(cols * cell) / 2 - minX * cell;
	const originY = -(rows * cell) / 2 - minY * cell;
	const pad = cell * 0.09;

	for (const [dx, dy] of net) {
		const crossroads = dx === 0 && dy === 0;
		g.rect(
			originX + dx * cell + pad,
			originY + dy * cell + pad,
			cell - pad * 2,
			cell - pad * 2
		).fill({
			color: active ? (crossroads ? 0xff6666 : CELL_RED) : 0x888888,
			alpha: active ? (crossroads ? 1 : 0.85) : 0.7
		});
	}
}

// Show the net picker only while the player is choosing where to lay a net — a normal
// creature selected for summoning, or standalone Unfold mode — and never once the match
// is over. It stays put through the whole placement so the shape can be changed mid-aim.
$effect(() => {
	const show = (!!selectedMonster?.billboard || unfolding) && !gameOver;
	if (netPanel) netPanel.visible = show;
});


	// Boot the board into `hostEl` (the flex canvas host) and measure `leftPanelEl`
	// (the floating dice panel) so the grid frames into the free space beside it.
	// Called from the page component's onMount; returns the teardown to run on
	// unmount. Mirrors the old top-level onMount, plus the reactive render effects
	// that used to live at the component's script top level.
	function mount(hostEl: HTMLDivElement, leftPanelEl?: HTMLElement) {
		host = hostEl;
		leftPanel = leftPanelEl;

		loadDeck();
		loadCpuDeck();

		// Load the dice template config, then seed both sides' match dice pools with the
		// full dice matrix (one copy of every die) so each player starts the match with
		// the same complete set to roll and consume. `diceReady` gates the opening roll so
		// it never fires before the pools are seeded.
		const diceReady = diceAdapter.loadTemplates().then((cfg) => {
			diceConfig = cfg;
			iconRoleMap = diceAdapter.roleByIcon(cfg);
			void loadRoleIcons(cfg);
			seedMatchDice();
		});


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
// 'passive' (not 'none'): the plaque itself isn't hit-tested, but its interactive card
// sprites (added by addPlaqueCard) still emit the hover events that drive the viewer.
playerPlaque.container.eventMode = 'passive';
camera.addChild(playerPlaque.container);

rivalPlaque.container = new Container();
rivalPlaque.container.setFromMatrix(RIVAL_BOARD_MATRIX);
rivalPlaque.container.eventMode = 'passive';
camera.addChild(rivalPlaque.container);

// World-space row for the player's hand (upright card PNGs just outside the grid's
// bottom-left edge). Inside `camera` like the two plaques, so it pans and zooms with
// the board; added above them so its cards read on top. Painted by renderHand
// (reactive to `hand`).
handLayer = new Container();
// 'passive' (not 'none'): the layer itself isn't hit-tested, but its interactive
// children — the clickable hand cards added by addHandCard — still emit events.
// 'none' would suppress events on the children too.
handLayer.eventMode = 'passive';
camera.addChild(handLayer);

// World-space row for the rival's hand (face-down card backs just outside the grid's
// top-right edge), the mirror of the player's hand layer. 'none' — the rival's cards are
// hidden and inert, so nothing in this layer is ever hit-tested. Painted by renderCpuHand
// (reactive to `cpuHand`).
cpuHandLayer = new Container();
cpuHandLayer.eventMode = 'none';
camera.addChild(cpuHandLayer);

// The world-space action-button column (Move/Combat/Unfold/End Turn), under the
// player's red dice row. 'passive' like the hand layer so its interactive button
// children still receive clicks. Painted by renderActionButtons (reactive).
actionLayer = new Container();
actionLayer.eventMode = 'passive';
camera.addChild(actionLayer);

// The world-space match-dice display: each side's remaining dice as little static
// isometric cubes laid past its card plaque. 'passive' like the hand/action layers so
// its interactive children (the player's click-to-pick dice and the Roll button) still
// receive clicks. Painted by renderDiceDisplay (reactive to each side's pool + the pick).
diceDisplayLayer = new Container();
diceDisplayLayer.eventMode = 'passive';
camera.addChild(diceDisplayLayer);

// The in-canvas dice-net picker, in the empty triangle below the grid's south-west
// edge. Added above the board layers so its thumbnails read on top; hidden until a
// net action starts (see the visibility $effect).
buildNetPanel();

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

// Sprite + Assets let the energy dice paint their owned faces' baked PNGs; the
// other boxes (HP, combat) roll plain numeral dice and ignore them.
const pixi = { Container, Graphics, Text, Matrix, Sprite, Assets };
anchorDice = new Dice3D({ app, layer: diceLayer, pixi, boxSize: DICE_BOX_SIZE });
playerEnergyDice = new Dice3D({ app, layer: worldDice, pixi, boxSize: DICE_WORLD_SIZE });
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

			// Yellow reference outline around the grid + both card plaques, added on top
			// of the board layers so its lines stay visible.
			drawBoardFrame();

			// Paint the (initially empty) hand row; its $effect repaints it as cards are
			// drawn, summoned, and as the energy pool changes.
			renderHand();

			// Paint the (initially empty) rival hand row of face-down backs; its $effect
			// repaints it as the rival draws and summons.
			renderCpuHand();

			// Paint each side's match-dice display past its plaque; its $effect repaints as
			// dice are rolled and consumed and as the player's turn-start pick changes. Both
			// pools are seeded once the template config loads (seedMatchDice), which also
			// triggers this render via the effect.
			renderDiceDisplay();

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

			// Load the face-down card back used for the rival's hand. Assigning it re-runs
			// renderCpuHand's effect so the backs paint once the art lands.
			cardBackTexture = await Assets.load('/assets/card-back.png');

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

			// Paint the action-button column now that the red origin (its anchor) exists;
			// its $effect repaints it as the inspected unit, energy and turn flags change.
			renderActionButtons();

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

			// Open the match by starting the player's turn-start dice pick below their
			// red origin hearts — the same phase that begins each of their later turns.
			// Wait for the dice config to load first so the pool is never empty. The
			// rival picks and rolls on its own turn (see runCpuTurn), not now.
			await diceReady;
			beginPlayerDicePhase();
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

	// Special (Fusion / Ritual) summon: while placing, clicking a highlighted red
	// tile drops the special monster onto it. While picking sacrifices, tile taps
	// are inert (materials are chosen by clicking creatures, not tiles).
	if (specialPhase === 'placing') {
		if (isSpecialPlacementTile(x, y)) placeSpecial(x, y);
		return;
	}
	if (specialPhase === 'materials') return;

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
		if (energy.summon < UNFOLD_COST) return;
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

		energy.summon -= UNFOLD_COST;
		return;
	}

	const monster = selectedMonster;
	if (!monster?.billboard) return;

	// Not enough summon energy to summon this monster: ignore the placement.
	if (monster.cost > energy.summon) return;

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

		// Pay the summon cost out of the summon energy pool.
		energy.summon -= monster.cost;

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
	}

	return {
		// Fixed match parameters the sidebar reads directly.
		HAND_SIZE,
		UNFOLD_COST,
		ORIGIN_LP,
		sortColumns,

		// Boot the renderer; returns the teardown for the component's onMount.
		mount,

		// Reactive slices consumed by the sidebar/overlays (getters so each read
		// tracks the underlying `$state`/`$derived`).
		get deck() {
			return deck;
		},
		get hand() {
			return hand;
		},
		get handCards() {
			return handCards;
		},
		get sortKey() {
			return sortKey;
		},
		get sortDir() {
			return sortDir;
		},
		get energy() {
			return energy;
		},
		get cpuEnergy() {
			return cpuEnergy;
		},
		// The player's turn-start dice-pick phase: whether the picker overlay is open,
		// the dice it chooses from (the player's owned dice, or the starter trio when
		// they own none), and how many the roll uses.
		get pickingDice() {
			return pickingDice;
		},
		get dicePool() {
			return dicePool();
		},
		get dicePickCount() {
			return dicePickCount();
		},
		get turnNumber() {
			return turnNumber;
		},
		get rolling() {
			return rolling;
		},
		get energyRolled() {
			return energyRolled;
		},
		get summoning() {
			return summoning;
		},
		get rivalThinking() {
			return rivalThinking;
		},
		get moving() {
			return moving;
		},
		get combating() {
			return combating;
		},
		get unfolding() {
			return unfolding;
		},
		get selectedMonster() {
			return selectedMonster;
		},
		// The staged Fusion / Ritual card and its phase, so the hand tray can reflect
		// which card is mid-summon and lock the rest while it resolves. The whole
		// interaction (picking sacrifices, Confirm/Cancel, placement) plays out on the
		// canvas; these are read-only signals for the DOM tray.
		get specialSummonCard() {
			return specialCard;
		},
		get specialPhase() {
			return specialPhase;
		},
		get inspectedCreature() {
			return inspectedCreature;
		},
		// The card shown in the top-right preview slot: the inspected creature when one
		// is loaded, otherwise the first card in the player's hand so the slot always
		// previews something. Kept separate from inspectedCreature so the unit actions
		// stay disabled until a real creature is inspected (the hand default is view-only).
		get previewCreature() {
			return inspectedCreature ?? handCards[0] ?? null;
		},
		get inspectedIsPlayer() {
			return inspectedIsPlayer;
		},
		get inspectedCanCombat() {
			return inspectedCanCombat;
		},
		get combatResult() {
			return combatResult;
		},
		get combatBoxHits() {
			return combatBoxHits;
		},
		get gameOver() {
			return gameOver;
		},
		// The generated-card image URL of the card the pointer is hovering on the canvas
		// (hand card, played plaque card, or on-board creature), or null. The board page
		// renders it as the fixed bottom-left DOM card viewer.
		get previewCardSrc() {
			return previewCardId != null ? `/cards/generated/${previewCardId}.png` : null;
		},
		// The Move / Combat actions of the unit the viewer's card belongs to, so the DOM
		// viewer can offer the same buttons the creature unfolds on the board. Empty unless
		// the card was hovered on a player unit that is still alive — a hand card, a plaque
		// card or a rival creature leaves the viewer view-only. Recomputed on read, so it
		// tracks the energy pools and the move / combat flags exactly like the on-board pair.
		get previewUnitActions(): UnitAction[] {
			if (previewUnitId == null) return [];
			const unit = placedUnits.get(previewUnitId);
			if (!unit || unit.side !== 'player') return [];
			return unitActions(unit);
		},
		// Whether the yellow play-area outline is drawn; the page's top-left panel reads
		// it and flips it via toggleBoardFrame.
		get boardFrameVisible() {
			return boardFrameVisible;
		},

		// The player's commands, driven by the sidebar buttons and hand tiles. Move and
		// Combat are now started from the on-board hover buttons (they need the specific
		// PlacedUnit), so they're no longer part of the external command surface.
		canSummon,
		toggleSort,
		inspectCard,
		selectMonster,
		cancelMove,
		cancelCombat,
		startUnfold,
		endTurn,
		confirmDicePick,
		toggleBoardFrame
	};
}

export type BoardEngine = ReturnType<typeof createBoardEngine>;
