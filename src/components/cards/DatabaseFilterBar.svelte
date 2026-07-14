<script lang="ts">
	import classNames from 'classnames';
	import { onMount } from 'svelte';

	let { 
		search = '',
		type_filter = 'all',
		attribute_filter = 'all',
		race_filter = 'all',
		filterableTypes: typesList = [],
		filterableAttributes: attributesList = [],
		filterableRaces: racesList = [],
		onSearch,
		onClearSearch,
		onTypeFilter,
		onAttributeFilter,
		onRaceFilter,
	}: {
		search: string;
		type_filter: string;
		attribute_filter: string;
		race_filter: string;
		filterableTypes: string[];
		filterableAttributes: string[];
		filterableRaces: string[];
		onSearch?: (q: string) => void;
		onClearSearch?: () => void;
		onTypeFilter?: (t: string) => void;
		onAttributeFilter?: (a: string) => void;
		onRaceFilter?: (r: string) => void;
	} = $props();

	let debouncedSearch = '';
	let timer: ReturnType<typeof setTimeout>;

	const TYPE_ALL = { value: 'all', label: 'All Types' };
	const ATTR_ALL = { value: 'all', label: 'All Attributes' };
	const RACE_ALL = { value: 'all', label: 'All Races' };

	const TYPES = [TYPE_ALL, ...typesList.map((t) => ({ value: t, label: t }))];
	const ATTRIBUTES = [ATTR_ALL, ...attributesList.map((a) => ({ value: a, label: a }))];
	const RACES = [RACE_ALL, ...racesList.map((r) => ({ value: r, label: r }))];

	let showType = $state(false);
	let showAttr = $state(false);
	let showRace = $state(false);

	function setSearch(q: string) {
		debouncedSearch = q;
		clearTimeout(timer);
		timer = setTimeout(() => onSearch?.(q), 300);
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	function handleClickOutside(e: MouseEvent) {
		const targets = [e.target as HTMLElement];
		if (targets.some(t => t.closest('.filter-dropdown'))) {
			return;
		}
		showType = false;
		showAttr = false;
		showRace = false;
	}

	function toggleDropdown(name: 'type' | 'attr' | 'race') {
		if (name === 'type') showType = !showType;
		if (name === 'attr') showAttr = !showAttr;
		if (name === 'race') showRace = !showRace;
	}

	function selectFilter(name: 'type' | 'attr' | 'race', value: string) {
		if (name === 'type') onTypeFilter?.(value);
		if (name === 'attr') onAttributeFilter?.(value);
		if (name === 'race') onRaceFilter?.(value);
		showType = false;
		showAttr = false;
		showRace = false;
	}

	function clearAll() {
		onSearch?.('');
		onClearSearch?.();
		onTypeFilter?.('all');
		onAttributeFilter?.('all');
		onRaceFilter?.('all');
	}
</script>

<div class="flex flex-col gap-4 sm:flex-row sm:items-center">
	<!-- Search Input -->
	<div class="relative flex-1">
		<label for="card-search" class="sr-only">Search cards by name</label>
		<input
			id="card-search"
			type="text"
			placeholder="Search cards..."
			class="input input-bordered w-full max-w-xs"
			bind:value={search}
			oninput={(e) => setSearch((e.target as HTMLInputElement).value)}
			list="card-suggestions"
		/>
		<datalist id="card-suggestions">
		</datalist>
		{#if search}
			<button
				class="absolute right-3 top-1/2 -translate-y-1/2 text-base-content/40 hover:text-base-content"
				onclick={() => { search = ''; setSearch(''); }}
				aria-label="Clear search"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		{/if}
	</div>

	<!-- Filter Dropdowns -->
	<div class="flex gap-2">
		<!-- Type Filter -->
		<div class="filter-dropdown relative">
			<button
				class={classNames('btn btn-sm', type_filter !== 'all' ? 'btn-primary' : '', 'dropdown dropdown-open')}
				onclick={() => toggleDropdown('type')}
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-2.414 2.414a1 1 0 01-.707.293H7.414a1 1 0 01-.707-.293L3.293 8.293A1 1 0 013 7.586V4z" />
				</svg>
				Type
			</button>
			{#if showType}
				<ul class="dropdown-content z-50 menu rounded-box w-52 bg-base-100 p-2 shadow-xl">
					{#each TYPES as t}
						<li>
							<button type="button"
								class={t.value === type_filter ? 'active' : ''}
								onclick={() => selectFilter('type', t.value)}
							>
								{t.label}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Attribute Filter -->
		<div class="filter-dropdown relative">
			<button
				class={classNames('btn btn-sm', attribute_filter !== 'all' ? 'btn-primary' : '')}
				onclick={() => toggleDropdown('attr')}
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
				</svg>
				Attribute
			</button>
			{#if showAttr}
				<ul class="dropdown-content z-50 menu rounded-box bg-base-100 p-2 shadow-xl">
					{#each ATTRIBUTES as a}
						<li>
							<button type="button"
								class={a.value === attribute_filter ? 'active' : ''}
								onclick={() => selectFilter('attr', a.value)}
							>
								{a.label}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Race Filter -->
		<div class="filter-dropdown relative">
			<button
				class={classNames('btn btn-sm', race_filter !== 'all' ? 'btn-primary' : '')}
				onclick={() => toggleDropdown('race')}
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="mr-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				Race
			</button>
			{#if showRace}
				<ul class="dropdown-content z-50 menu rounded-box bg-base-100 p-2 shadow-xl">
					{#each RACES as r}
						<li>
							<button type="button"
								class={r.value === race_filter ? 'active' : ''}
								onclick={() => selectFilter('race', r.value)}
							>
								{r.label}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Clear All -->
		<button
			class="btn btn-ghost btn-sm"
			onclick={clearAll}
		>
			Clear All
		</button>
	</div>
</div>

<style>
	.dropdown-content {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.25rem;
		z-index: 50;
	}
	.active {
		background-color: hsl(var(--pf) / var(--tw-bg-opacity, 1));
		color: hsl(var(--pc) / var(--tw-text-opacity, 1));
	}
</style>
