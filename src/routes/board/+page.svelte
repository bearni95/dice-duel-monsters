<script lang="ts">
	import { onMount } from 'svelte';
import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
	import GameCard from '$components/cards/GameCard.svelte';
	import DiceRoller from '$components/dice/DiceRoller.svelte';

	import type { IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';
	import { deckService } from '$services/deck.service';

	let host: HTMLDivElement;

	let cards = $state<IGameCreature[]>([]);
	let loading = $state(false);

	const cardApiAdapter = new CardApiAdapter();

	let selectedMonster = $state<IGameCreature | null>(null);
	// Energy points accumulated from dice rolls in the card-container header.
	let energyPoints = $state(0);
	// IDs of cards already placed on the board (disabled in the tray).
	let placedIds = $state<string[]>([]);

	// A card can be summoned when it's not already placed and its cost fits
	// the current energy pool.
	function canSummon(card: IGameCreature): boolean {
		return !placedIds.includes(card.id) && card.cost <= energyPoints;
	}

	// Tray order: summonable cards first, then by cost ascending.
	let sortedCards = $derived(
		[...cards].sort((a, b) => {
			const aSummon = canSummon(a);
			const bSummon = canSummon(b);

			if (aSummon !== bSummon) return aSummon ? -1 : 1;

			return a.cost - b.cost;
		})
	);
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

			cards = cardApiAdapter.cards.splice(0, 5);

			console.log('cards', cards);
		} catch (e) {
			console.error('Failed to load cards:', e);
		} finally {
			loading = false;
		}
	}

	// Use the player's saved deck (from /decks) as the hand. Falls back to a
	// random monster pull when no deck has been rendered yet.
	async function loadDeck() {
		const deck = deckService.get();

		if (!deck.main.length) {
			await loadCards(1);
			return;
		}

		loading = true;

		try {
			await cardApiAdapter.loadByIds(deck.main);
			// Only keep cards that have a billboard image, so every tray card is placeable.
			cards = cardApiAdapter.cards.filter((c) => c.billboard);
		} catch (e) {
			console.error('Failed to load deck:', e);
		} finally {
			loading = false;
		}
	}

		const app = new Application();

		const TILE_WIDTH = 64;
		const TILE_HEIGHT = 32;
		const GRID_WIDTH = 15;
		const GRID_HEIGHT = 15;

		const MIN_ZOOM = 0.25;
		const MAX_ZOOM = 4;

		let camera: Container;
let grid: Container;
let labels: Container;
let units: Container;

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

async function placeMonster(
	texturePath: string,
	gridX: number,
	gridY: number
) {
	const texture = await Assets.load(texturePath);

	const sprite = new Sprite(texture);

	const scale = TILE_WIDTH / texture.width;
	sprite.scale.set(scale);
	sprite.anchor.set(0.5, 0.75);

	const isoX = (gridX - gridY) * (TILE_WIDTH / 2);
	const isoY = (gridX + gridY) * (TILE_HEIGHT / 2);

	sprite.position.set(isoX, isoY);

	units.addChild(sprite);

	clearPreview();

	// Paint the floor in the unfolded-dice "T" shape, with the
	// played tile as the crossroads of the cross. Every painted tile is
	// recorded as occupied in red.
	for (const [dx, dy] of DICE_NET_OFFSETS) {
		paintCell(gridX + dx, gridY + dy, CELL_RED);
	}
}

// Show a 50%-opacity ghost of the selected card's billboard and its
// "T" floor at the tile it would be placed on.
async function showPreview(
	texturePath: string,
	gridX: number,
	gridY: number
) {
	clearPreview();

	const token = ++previewToken;

	// Preview the "T" tiles at 50% opacity (skip already-placed ones).
	for (const [dx, dy] of DICE_NET_OFFSETS) {
		const x = gridX + dx;
		const y = gridY + dy;
		const key = tileKey(x, y);

		if (occupied.has(key)) continue;

		const tile = tiles.get(key);
		if (!tile) continue;

		tile.tint = 0xff0000;
		tile.alpha = 0.5;
		previewTiles.push(key);
	}

	// Ghost billboard sprite at the crossroads.
	const texture = await Assets.load(texturePath);

	// Pointer already left / another preview started while loading.
	if (token !== previewToken) return;

	if (!previewSprite) {
		previewSprite = new Sprite(texture);
		previewSprite.anchor.set(0.5, 0.75);
		previewSprite.alpha = 0.5;
		units.addChild(previewSprite);
	} else {
		previewSprite.texture = texture;
	}

	previewSprite.scale.set(TILE_WIDTH / texture.width);

	const isoX = (gridX - gridY) * (TILE_WIDTH / 2);
	const isoY = (gridX + gridY) * (TILE_HEIGHT / 2);
	previewSprite.position.set(isoX, isoY);
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


		let dragging = false;
		let lastX = 0;
		let lastY = 0;

		async function init() {
			await app.init({
				resizeTo: window,
				background: '#1b1b1b',
				antialias: true
			});

			host.appendChild(app.canvas);

			camera = new Container();

grid = new Container();
labels = new Container();
units = new Container();

camera.addChild(grid);
camera.addChild(labels);
camera.addChild(units);

app.stage.addChild(camera);

			camera.x = app.screen.width / 2;
			camera.y = 120;


			buildGrid();

			buildLabels();

			// Permanently record the pre-painted cells (column O = x 14):
			// O1 (row 1 = y 0) in red, O15 (row 15 = y 14) in blue.
			paintCell(14, 0, CELL_RED);
			paintCell(0, 14, CELL_BLUE);

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

					// Always-visible cell outline (no fill) keeps the grid legible.
					const outline = new Graphics();
					drawDiamond(outline).stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
					outline.position.set(isoX, isoY);
					grid.addChild(outline);

					// Interactive fill, empty (transparent) by default; revealed by
					// raising alpha + tinting on hover, preview and placement.
					const tile = new Graphics();
					drawDiamond(tile).fill(0xffffff);
					tile.position.set(isoX, isoY);
					tile.alpha = 0;

					tile.on('pointertap', async () => {
	const monster = selectedMonster;
	if (!monster?.billboard) return;

	// Not enough energy to summon this monster: ignore the placement.
	if (monster.cost > energyPoints) return;

	await placeMonster(monster.billboard, x, y);

	// Pay the summon cost out of the energy pool.
	energyPoints -= monster.cost;

	// The card is now on the board: drop selection + hover preview
	// and mark it placed so the tray card becomes disabled.
	selectedMonster = null;
	clearPreview();

	if (!placedIds.includes(monster.id)) {
		placedIds = [...placedIds, monster.id];
	}
});

					tile.eventMode = 'static';
					tile.cursor = 'pointer';

					tile.on('pointerover', () => {
	if (selectedMonster?.billboard) {
		showPreview(selectedMonster.billboard, x, y);
	} else if (!occupied.has(tileKey(x, y))) {
		tile.tint = 0xffcc66;
		tile.alpha = 1;
	}
});

tile.on('pointerout', () => {
	if (selectedMonster?.billboard) {
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

<div bind:this={host} class="viewport"></div>

<div
	class="fixed bottom-2 center border bg-base-100 w-full flex flex-col max-h-[50vh] overflow-y-auto"
>
	<DiceRoller {energyPoints} onRoll={(total) => (energyPoints += total)} />

	<div class="grid grid-cols-5">
		{#each sortedCards as card (card.id)}
			{@const disabled = !canSummon(card)}
			<div
				class="relative"
				class:opacity-40={disabled}
				class:pointer-events-none={disabled}
			>
				<GameCard {card} />

				{#if card.billboard}
					<img
		class="absolute top-0 right-0"
		class:cursor-pointer={!disabled}
		class:cursor-not-allowed={disabled}
		class:ring={selectedMonster?.id === card.id}
		class:ring-yellow-400={selectedMonster?.id === card.id}
		src={card.billboard}
		alt={card.name}
		onclick={() => {
			if (disabled) return;
			selectedMonster = card;
		}}
	/>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #1b1b1b;
	}

	.viewport {
		position: fixed;
		inset: 0;
	}
</style>