import capitalize from '$utils/string/capitalize';
import type { NavRoute } from '$types/navigation.type';

const ROUTES_PREFIX = '/src/routes';
const PAGE_SUFFIX = '/+page.svelte';

interface FlatRoute {
	path: string;
	segments: string[];
}

/**
 * Transforms the file paths of SvelteKit `+page.svelte` files into a sorted
 * list of navigable routes. Pure function so it can be unit tested; the actual
 * file discovery happens at build time via `import.meta.glob` (see `routes.ts`).
 *
 * Dynamic (`[param]`) and grouped (`(group)`) segments are skipped since they
 * can't be linked to as plain buttons.
 *
 * Nested routes (more than one segment, e.g. `/cards`) are collected
 * under a single parent nav item keyed by their first segment (e.g. `Admin`),
 * which renders them as a submenu instead of top-level buttons.
 */
export default function buildRoutes(pagePaths: string[]): NavRoute[] {
	const flat: FlatRoute[] = pagePaths
		.map((pagePath) =>
			pagePath.replace(ROUTES_PREFIX, '').replace(PAGE_SUFFIX, '')
		)
		.filter((path) => !/[[\]()]/.test(path))
		.map((path) => ({
			path: path === '' ? '/' : path,
			segments: path.split('/').filter(Boolean)
		}));

	// Root (`/`) is always a plain top-level item.
	const routes: NavRoute[] = flat
		.filter((route) => route.segments.length === 0)
		.map(() => ({ path: '/', label: 'Home' }));

	// Group everything else by its first path segment so nested routes fold
	// into a single parent with a submenu.
	const groups = new Map<string, FlatRoute[]>();
	for (const route of flat) {
		if (route.segments.length === 0) continue;
		const key = route.segments[0];
		const bucket = groups.get(key) ?? [];
		bucket.push(route);
		groups.set(key, bucket);
	}

	for (const [segment, bucket] of groups) {
		const own = bucket.find((route) => route.segments.length === 1);
		const children = bucket
			.filter((route) => route.segments.length > 1)
			.map((route) => ({
				path: route.path,
				label: capitalize(route.segments[route.segments.length - 1])
			}))
			.sort((a, b) => a.label.localeCompare(b.label));

		if (children.length === 0) {
			// Simple top-level route with its own page.
			routes.push({ path: `/${segment}`, label: capitalize(segment) });
			continue;
		}

		// Parent grouping item: links to its own index page when one exists,
		// otherwise just anchors the submenu.
		routes.push({
			path: own?.path ?? `/${segment}`,
			label: capitalize(segment),
			children
		});
	}

	// Home first, then the rest alphabetically by label.
	return routes.sort((a, b) => {
		if (a.path === '/') return -1;
		if (b.path === '/') return 1;
		return a.label.localeCompare(b.label);
	});
}
