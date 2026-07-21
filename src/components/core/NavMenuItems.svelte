<script lang="ts">
	import { page } from '$app/stores';
	import classNames from 'classnames';
	import type { NavRoute } from '$types/navigation.type';
	import { createEventDispatcher } from 'svelte';

	// Routes to render at this level of the tree.
	export let items: NavRoute[] = [];

	const dispatch = createEventDispatcher<{ navigate: void }>();

	function isCurrent(path: string): boolean {
		return $page.url.pathname === path;
	}
</script>

<ul class="menu w-full gap-1 p-0">
	{#each items as item (item.path)}
		<li>
			<a
				href={item.path}
				class={classNames({ 'menu-active': isCurrent(item.path) })}
				on:click={() => dispatch('navigate')}
			>
				{item.label}
			</a>
			{#if item.children?.length}
				<!-- Non-toggleable: submenus are always expanded, never collapsed. -->
				<svelte:self items={item.children} on:navigate />
			{/if}
		</li>
	{/each}
</ul>
