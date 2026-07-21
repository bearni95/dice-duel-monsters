import type { Container, Graphics, Sprite } from 'pixi.js';
import type { IGameCreature } from '$adapters/creature.adapter';

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
