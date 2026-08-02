import type { Container, Graphics, Sprite } from 'pixi.js';
import type { IGameCreature } from '$adapters/creature.adapter';
import type { DiceRole } from '$types/dice.type';

// Which side of the board a unit belongs to. The player commands the red
// network (origin L12); the CPU rival commands the blue one (origin A1).
export type Side = 'player' | 'cpu';

// A creature that has been summoned onto the board, with its live sprite and
// grid position (updated as it moves). Its HP is tracked live and mirrored by
// a progressbar floating above the sprite.
export interface PlacedUnit {
	unitId: number;
	side: Side;
	creature: IGameCreature;
	sprite: Sprite;
	// Flattened black ellipse painted on the unit's cell as its shadow.
	shadow: Graphics;
	// Purple reference square on the unit's cell — the fixed cell marker the
	// /cards board-preview modal draws (the offset is measured against it),
	// mirrored here so the board matches the preview. Independent of the sprite,
	// so it never moves with the card's x/y offset.
	cellSquare: Graphics;
	x: number;
	y: number;
	hp: number;
	maxHp: number;
	healthBar: Container;
	// The Move / Combat action buttons that unfold beneath this creature while the
	// pointer hovers it (player units only). Lives in the `overlays` layer, pinned
	// under the sprite; hidden until hovered. Built lazily on summon.
	actionGroup?: Container;
}

// The card stat an action plays out with: a Move carries the creature as far as its SPD,
// a Combat rolls as many dice as its Atk.
export type UnitActionStat = 'speed' | 'atk';

// What an action does for this particular creature, printed on its button beside the
// energy cost so the payoff reads before the click. `iconSrc` is the same glyph the card
// prints the stat under, so the button and the card agree at a glance.
export interface UnitActionEffect {
	stat: UnitActionStat;
	label: string;
	iconSrc: string;
	value: number;
}

// One action a placed player unit can take right now — Move / Combat, or the single
// Cancel that replaces the pair while one of them is in flight — as plain data. Both
// the on-board Pixi buttons and the DOM card viewer's button row render from this same
// list, so the two can never disagree on a label, a cost or whether an action is live.
export interface UnitAction {
	key: 'move' | 'combat' | 'cancel-move' | 'cancel-combat';
	label: string;
	variant: 'primary' | 'error';
	enabled: boolean;
	// The energy pool this action spends and what it costs, printed beside the label.
	// Null / 0 on a Cancel, which spends nothing.
	role: DiceRole | null;
	cost: number;
	// URL of the role's element icon (the same glyph the energy counters show), or
	// null for a Cancel and until the dice config loads.
	iconSrc: string | null;
	// What the creature does with that energy (its SPD for a move, its Atk for a
	// combat). Null on a Cancel, which has no effect to preview.
	effect: UnitActionEffect | null;
	// Fire the action. The same call the on-board button makes.
	run: () => void;
}

// A destroyable origin cell: its grid position, network side/color, remaining
// life points and the heart stack drawn over it as its LP counter (one heart per
// point, rebuilt as it takes hits).
export interface OriginCell {
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

// One thing the rival can legally do this turn: summon a creature onto a
// tile/rotation, relocate one of its units to a reachable tile, or attack a
// player creature / the player's origin within one of its units' reach.
export interface CpuMove {
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

// A card plaque laid flat on the board: the player's red one at the bottom-right,
// the rival's blue one at the top-left. Each holds its live Pixi container (built
// in init, added to `camera`), a token bumped on each render so a slow PNG load
// from a superseded render can't paint stale art, and the border color of its
// network.
export interface CardPlaque {
	// Whose plaque this is, so its cards can be keyed apart from the other side's when
	// one of them is selected (see the board engine's plaqueCardKey).
	side: Side;
	container?: Container;
	token: number;
	borderColor: number;
}

// Last combat outcome (dice faces + hit tally), shown as a brief toast.
export interface CombatResult {
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
}

// Battle outcome, snapshotting each origin's remaining hearts so the result reads
// correctly even as the board keeps its live objects around.
export interface GameOverResult {
	winner: Side;
	playerLp: number;
	rivalLp: number;
}

// The creature attributes the hand tray can be sorted by.
export type SortKey = 'cost' | 'atk' | 'def' | 'hp' | 'speed';

export interface SortColumn {
	key: SortKey;
	label: string;
}
