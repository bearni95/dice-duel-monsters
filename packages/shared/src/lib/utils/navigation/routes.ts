import buildRoutes from '$utils/navigation/buildRoutes';
import type { NavRoute } from '$types/navigation.type';

// `import.meta.glob` is resolved by Vite at build time, so the route list is
// baked in and never scans the filesystem at runtime. Only the admin app renders
// the nav, so every page it discovers is a real destination — no filtering.
const pages = import.meta.glob('/src/routes/**/+page.svelte');

export const routes: NavRoute[] = buildRoutes(Object.keys(pages));
