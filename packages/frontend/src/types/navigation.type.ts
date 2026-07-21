export interface NavRoute {
	/** The URL path for the route, e.g. `/` or `/board`. */
	path: string;
	/** Human-readable label derived from the route segment. */
	label: string;
	/**
	 * Nested routes rendered as a submenu under this item. Present on grouping
	 * items (e.g. `/admin`) that collect their subroutes rather than linking to
	 * a page of their own.
	 */
	children?: NavRoute[];
}
