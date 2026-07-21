import buildRoutes from '$utils/navigation/buildRoutes';
import type { NavRoute } from '$types/navigation.type';

// `import.meta.glob` is resolved by Vite at build time, so the route list is
// baked in and never scans the filesystem at runtime.
const pages = import.meta.glob('/src/routes/**/+page.svelte');

// Admin tooling is only bundled when explicitly enabled for local dev (see
// vite.config.ts); drop its links from the nav otherwise so the stubbed pages
// are never advertised.
const pagePaths = Object.keys(pages).filter(
	(path) => import.meta.env.VITE_ADMIN_ENABLED || !path.includes('/src/routes/admin/')
);

export const routes: NavRoute[] = buildRoutes(pagePaths);
