<script lang="ts">
	import { onMount } from 'svelte';
import { Application, Assets, Container, Graphics, Sprite } from 'pixi.js';
	import GameCard from '$components/cards/GameCard.svelte';

	import type { IGameCreature } from '$adapters/creature.adapter';
	import { CardApiAdapter } from '$adapters/cardApi.adapter';

	let host: HTMLDivElement;

	let cards = $state<IGameCreature[]>([]);
	let loading = $state(false);

	const cardApiAdapter = new CardApiAdapter();

	const deck = [
		{
			id: 6032,
			name: '3-Hump Lacooda',
			fullImage: '/cards/full/6032.png',
			monsterBillboard: '/cards/monster-billboards/MBB_006032.png'
		},
		{
			id: 5139,
			name: '4-Starred Ladybug of Doom',
			fullImage: '/cards/full/5139.png',
			monsterBillboard: '/cards/monster-billboards/MBB_005139.png'
		},
		{
			id: 4446,
			name: '7 Colored Fish',
			fullImage: '/cards/full/4446.png',
			monsterBillboard: '/cards/monster-billboards/MBB_004446.png'
		}
	];

	const deckMap = new Map(deck.map((card) => [card.name, card]));
let selectedMonster: (typeof deck)[number] | null = null;
	async function loadCards(
		p: number,
		q = '',
		type = 'all',
		attr = 'all',
		race = 'all'
	) {
		loading = true;

		try {
			await cardApiAdapter.load(p, q, type, attr, race);

			// Keeping splice() to preserve current behavior.
			cards = cardApiAdapter.cards.splice(0, 5);

			console.log('cards', cards);
		} catch (e) {
			console.error('Failed to load cards:', e);
		} finally {
			loading = false;
		}
	}

		const app = new Application();

		const TILE_WIDTH = 64;
		const TILE_HEIGHT = 32;
		const GRID_WIDTH = 20;
		const GRID_HEIGHT = 20;

		const MIN_ZOOM = 0.25;
		const MAX_ZOOM = 4;

		let camera: Container;
let grid: Container;
let units: Container;

async function placeMonster(
	texturePath: string,
	x: number,
	y: number
) {
	const texture = await Assets.load(texturePath);

	const sprite = new Sprite(texture);

	sprite.anchor.set(0.5, 1);

	sprite.position.set(x, y);

	units.addChild(sprite);
}
	onMount(() => {
		loadCards(1);


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
units = new Container();

camera.addChild(grid);
camera.addChild(units);

app.stage.addChild(camera);

			camera.x = app.screen.width / 2;
			camera.y = 120;


			buildGrid();

			setupControls();

			app.renderer.on('resize', () => {});
		}

		function buildGrid() {
			for (let y = 0; y < GRID_HEIGHT; y++) {
				for (let x = 0; x < GRID_WIDTH; x++) {
					const tile = new Graphics();

					tile
						.moveTo(0, -TILE_HEIGHT / 2)
						.lineTo(TILE_WIDTH / 2, 0)
						.lineTo(0, TILE_HEIGHT / 2)
						.lineTo(-TILE_WIDTH / 2, 0)
						.closePath()
						.fill(0x4d8cff)
						.stroke({
							width: 1,
							color: 0xffffff,
							alpha: 0.15
						});

					const isoX = (x - y) * (TILE_WIDTH / 2);
					const isoY = (x + y) * (TILE_HEIGHT / 2);

					tile.position.set(isoX, isoY);

					tile.on('pointertap', async () => {
	if (!selectedMonster) return;

	await placeMonster(
		selectedMonster.monsterBillboard,
		isoX,
		isoY
	);
});

					tile.eventMode = 'static';
					tile.cursor = 'pointer';

					tile.on('pointerover', () => {
						tile.tint = 0xffcc66;
					});

					tile.on('pointerout', () => {
						tile.tint = 0xffffff;
					});

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

<div class="fixed bottom-2 center border bg-base-100 w-full grid grid-cols-5">
	{#each cards as card (card.id)}
		{@const deckCard = deckMap.get(card.name)}

		<div class="relative">
			<GameCard {card} />

			{#if deckCard}
				<img
	class="absolute top-0 right-0 cursor-pointer"
	class:ring={selectedMonster?.id === deckCard.id}
	class:ring-yellow-400={selectedMonster?.id === deckCard.id}
	src={deckCard.monsterBillboard}
	alt={deckCard.name}
	onclick={() => {
		selectedMonster = deckCard;
	}}
/>
			{/if}
		</div>
	{/each}
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