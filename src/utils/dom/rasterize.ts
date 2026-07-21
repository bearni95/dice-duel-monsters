// Rasterize a live DOM element into a bitmap image, honoring its real rendered
// CSS. The browser has no built-in "draw this element onto a canvas", so this
// uses the standard technique: wrap a clone of the element in an SVG
// <foreignObject>, load that SVG as an <img>, then draw the img onto a canvas.
//
// The catch with <foreignObject> is that when an SVG is loaded through an <img>
// it renders in a sandbox that cannot fetch any external resource and does not
// inherit the page's stylesheets. So for the clone to look identical to the
// original we must, before serializing:
//   1. flatten every element's *computed* style onto an inline style attribute
//      (Tailwind classes, DaisyUI, drop-shadow filters, masks and all), and
//   2. inline every referenced asset — <img> sources and every url(...) in a
//      style (CSS mask-image, background-image, …) — as a base64 data URI.
//
// The result is a fully self-contained SVG that reproduces the element pixel for
// pixel, independent of the surrounding document.

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

// CSS properties whose values may carry url(...) references that must be inlined
// for the sandboxed SVG to resolve them.
const URL_STYLE_PROPS = [
	'background-image',
	'-webkit-mask-image',
	'mask-image',
	'border-image-source',
	'list-style-image'
];

// Fetch a URL and encode its bytes as a data URI, so a referenced asset can be
// embedded directly in the serialized SVG. Cross-origin fetches (e.g. the card
// art on an image CDN) rely on the server sending permissive CORS headers; if a
// fetch fails the original URL is returned unchanged so at worst that one asset
// is missing rather than the whole render failing.
async function toDataUri(
	url: string,
	cache: Map<string, string>,
	rewriteUrl?: (url: string) => string
): Promise<string> {
	const cached = cache.get(url);
	if (cached) return cached;

	try {
		const fetchUrl = rewriteUrl ? rewriteUrl(url) : url;
		const res = await fetch(fetchUrl, { mode: 'cors', cache: 'force-cache' });
		if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
		const blob = await res.blob();
		const dataUri = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
		cache.set(url, dataUri);
		return dataUri;
	} catch (err) {
		console.warn('rasterize: could not inline asset', url, err);
		cache.set(url, url);
		return url;
	}
}

// Pull every url("…") target out of a CSS value string.
function extractUrls(value: string): string[] {
	const urls: string[] = [];
	const re = /url\((['"]?)([^'")]+)\1\)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(value))) urls.push(match[2]);
	return urls;
}

// Copy the source element's fully-resolved computed style onto the clone as an
// inline style string, and collect every asset URL referenced by that style so
// the caller can inline it. Returns the URLs found on this element.
function inlineComputedStyle(source: Element, clone: Element): string[] {
	const computed = getComputedStyle(source);
	const urls: string[] = [];
	let css = '';

	for (const prop of computed) {
		const value = computed.getPropertyValue(prop);
		css += `${prop}:${value};`;
		if (URL_STYLE_PROPS.includes(prop) && value.includes('url(')) {
			urls.push(...extractUrls(value));
		}
	}

	clone.setAttribute('style', css);
	return urls;
}

// Walk the source tree and its structurally-identical clone in lockstep,
// flattening computed styles and gathering every referenced asset URL (style
// url(...) targets plus <img> sources).
function collectTree(
	source: Element,
	clone: Element,
	urls: Set<string>
): void {
	for (const url of inlineComputedStyle(source, clone)) urls.add(url);

	if (source instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
		// Take the URL the browser actually resolved and loaded on the *source*
		// image (currentSrc handles srcset; the fresh clone hasn't loaded yet), stamp
		// it onto the clone, and record it so it can be swapped for a data URI.
		const resolvedSrc = source.currentSrc || source.src;
		if (resolvedSrc) {
			clone.setAttribute('src', resolvedSrc);
			urls.add(resolvedSrc);
		}
	}

	const sourceChildren = source.children;
	const cloneChildren = clone.children;
	for (let i = 0; i < sourceChildren.length; i++) {
		collectTree(sourceChildren[i], cloneChildren[i], urls);
	}
}

// Replace every referenced asset URL in the clone (inline styles and <img> src)
// with its data-URI equivalent from the resolved map.
function replaceUrls(clone: Element, resolved: Map<string, string>): void {
	const style = clone.getAttribute('style');
	if (style && style.includes('url(')) {
		let next = style;
		for (const [url, dataUri] of resolved) {
			if (url !== dataUri) next = next.split(url).join(dataUri);
		}
		clone.setAttribute('style', next);
	}

	if (clone instanceof HTMLImageElement) {
		const src = clone.getAttribute('src');
		if (src && resolved.has(src)) clone.setAttribute('src', resolved.get(src)!);
		clone.removeAttribute('srcset');
		clone.removeAttribute('loading');
	}

	for (const child of Array.from(clone.children)) replaceUrls(child, resolved);
}

export interface RasterizeOptions {
	// Supersample factor for a crisper bitmap (the SVG is drawn at scale× the
	// element's CSS size). Defaults to the device pixel ratio.
	scale?: number;
	// Optional mapping applied only when *fetching* an asset to inline it, for
	// resources the browser can display but not read cross-origin (e.g. a CDN image
	// with no CORS headers, routed through a same-origin proxy). The original URL is
	// still what gets replaced in the output; only the fetch target changes.
	rewriteUrl?: (url: string) => string;
}

export interface RasterizeResult {
	// The decoded bitmap, ready to drawImage onto any canvas.
	image: HTMLImageElement;
	// Referenced assets (<img> sources, url(...) targets) that could NOT be inlined
	// — their fetch failed, so they were left as their original URL and render blank
	// inside the sandboxed SVG. Empty when every asset inlined cleanly. Callers use
	// this to avoid caching a render with missing art/icons.
	failedAssets: string[];
}

// Rasterize `source` to a loaded <img> whose intrinsic size is the element's CSS
// box multiplied by the supersample scale. The returned image is fully decoded
// and ready to drawImage onto any canvas.
export async function rasterizeElement(
	source: HTMLElement,
	options: RasterizeOptions = {}
): Promise<RasterizeResult> {
	const scale = options.scale ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

	const rect = source.getBoundingClientRect();
	const width = Math.ceil(rect.width);
	const height = Math.ceil(rect.height);

	// Deep clone, then flatten styles and gather assets across the whole subtree.
	const clone = source.cloneNode(true) as HTMLElement;
	const urls = new Set<string>();
	collectTree(source, clone, urls);

	// Fetch and inline every referenced asset, then swap the URLs in the clone.
	const cache = new Map<string, string>();
	const resolved = new Map<string, string>();
	await Promise.all(
		Array.from(urls).map(async (url) => {
			resolved.set(url, await toDataUri(url, cache, options.rewriteUrl));
		})
	);
	replaceUrls(clone, resolved);

	// An asset whose resolved value is still its original URL never inlined (its
	// fetch failed and toDataUri returned the URL unchanged); it will render blank
	// in the sandboxed SVG.
	const failedAssets = Array.from(urls).filter((assetUrl) => resolved.get(assetUrl) === assetUrl);

	// The foreignObject content must live in the XHTML namespace to be valid XML.
	clone.setAttribute('xmlns', XHTML_NS);
	const serialized = new XMLSerializer().serializeToString(clone);

	// Bake the supersample scale into the SVG's own pixel dimensions while keeping the
	// viewBox (and the foreignObject) at the element's CSS size. This makes the
	// browser rasterize the element's real layout at scale× resolution — the whole
	// card, text and icons included — rather than upscaling a low-res bitmap.
	const pixelWidth = Math.round(width * scale);
	const pixelHeight = Math.round(height * scale);

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" ` +
		`viewBox="0 0 ${width} ${height}">` +
		`<foreignObject x="0" y="0" width="${width}" height="${height}">` +
		serialized +
		`</foreignObject></svg>`;

	const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

	const img = new Image();
	await new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('rasterize: SVG image failed to load'));
		img.src = url;
	});
	if (typeof img.decode === 'function') {
		try {
			await img.decode();
		} catch {
			// decode() can reject on some engines even when the image is usable.
		}
	}
	return { image: img, failedAssets };
}
