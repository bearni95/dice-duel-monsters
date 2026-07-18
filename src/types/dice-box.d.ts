// Ambient typings for @3d-dice/dice-box, which ships without its own
// declarations. Only the surface used by the app is described.
declare module '@3d-dice/dice-box' {
	export interface DiceBoxConfig {
		container?: string;
		assetPath?: string;
		theme?: string;
		themeColor?: string;
		scale?: number;
		offscreen?: boolean;
		enableShadows?: boolean;
		id?: string;
	}

	export interface DiceRollResult {
		value: number;
		sides?: number;
		groupId?: number;
		rollId?: number;
		[key: string]: unknown;
	}

	// Per-roll overrides accepted by roll()/add() (e.g. tinting a single roll a
	// different color from the box's configured theme).
	export interface DiceRollOptions {
		theme?: string;
		themeColor?: string;
		newStartPoint?: boolean;
	}

	export default class DiceBox {
		constructor(config?: DiceBoxConfig);
		canvas: HTMLCanvasElement;
		init(): Promise<DiceBox>;
		roll(notation: string, options?: DiceRollOptions): Promise<DiceRollResult[]>;
		add(notation: string, options?: DiceRollOptions): Promise<DiceRollResult[]>;
		clear(): DiceBox;
		updateConfig(config: Partial<DiceBoxConfig>): DiceBox;
	}
}
