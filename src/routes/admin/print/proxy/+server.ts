import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Dev-only image proxy for the /admin/print canvas rasterizer. The card art lives
// on an external CDN that serves no CORS headers, so the browser can fetch it into
// an <img> (for display) but cannot read its bytes to inline it into the canvas.
// This endpoint refetches the remote image server-side — where CORS does not apply
// — and returns it from our own origin, so the rasterizer's inliner can read it.
// Like the other /admin endpoints this is dev tooling and is absent from the static
// production build.

// Only these hosts may be proxied, so the endpoint can't be used to fetch arbitrary
// URLs.
const ALLOWED_HOSTS = new Set(['images.ygoprodeck.com']);

export const GET: RequestHandler = async ({ url, fetch }) => {
	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url parameter');

	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw error(400, 'Invalid url parameter');
	}

	if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
		throw error(403, `Refusing to proxy ${parsed.hostname}`);
	}

	const upstream = await fetch(parsed.href);
	if (!upstream.ok) throw error(upstream.status, `Upstream fetch failed (${upstream.status})`);

	const body = await upstream.arrayBuffer();
	return new Response(body, {
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
			'cache-control': 'public, max-age=86400'
		}
	});
};
