<script lang="ts">
	import { page } from '$app/stores';
	import classNames from 'classnames';
	import Button from '$components/core/Button.svelte';
	import { ThemeColors, ThemeSizes } from '$types/core.type';
	import type { NavRoute } from '$types/navigation.type';
	import { routes } from '$utils/navigation/routes';

	function isActive(route: NavRoute): boolean {
		if (route.children?.length) {
			return $page.url.pathname.startsWith(route.path);
		}
		return $page.url.pathname === route.path;
	}
</script>

<nav class="navbar bg-base-200 shadow-sm">
	<div class="flex-1"></div>
	<div class="flex flex-none items-center gap-2">
		{#each routes as route (route.path)}
			{#if route.children?.length}
				<div class="dropdown dropdown-end">
					<Button
						label={route.label}
						size={ThemeSizes.Small}
						color={ThemeColors.Primary}
						outline={!isActive(route)}
						classes={classNames({ 'btn-active': isActive(route) })}
					/>
					<ul
						class="menu dropdown-content bg-base-100 rounded-box z-[1] mt-1 w-40 gap-1 p-2 shadow"
					>
						{#each route.children as child (child.path)}
							<li>
								<a
									href={child.path}
									class={classNames({
										'menu-active': $page.url.pathname === child.path
									})}
								>
									{child.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<Button
					href={route.path}
					label={route.label}
					size={ThemeSizes.Small}
					color={ThemeColors.Primary}
					outline={!isActive(route)}
					classes={classNames({ 'btn-active': isActive(route) })}
				/>
			{/if}
		{/each}
	</div>
</nav>
