import buildRoutes from '$utils/navigation/buildRoutes';
import type { NavRoute } from '$types/navigation.type';

// `import.meta.glob` is resolved by Vite at build time, so the route list is
// baked in and never scans the filesystem at runtime. The pattern is rooted at
// the *consuming* app's Vite root, so each app (admin, frontend) discovers its
// own pages here. Every page found is a real destination — no filtering.
const pages = import.meta.glob('/src/routes/**/+page.svelte');

export const routes: NavRoute[] = buildRoutes(Object.keys(pages));
