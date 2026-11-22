// mangee's image proxy: covers and chapter pages from MangaDex, through our own server
// (MangaDex answers hotlinked images with a wrong image, and asks sites to proxy them).
//
//   GET /api/mdimg?u=<MangaDex image URL>
//
// Only MangaDex hosts are fetched: uploads.mangadex.org (covers, and pages when served there)
// and *.mangadex.network (MangaDex@Home nodes). Pages are cached at the edge by their content
// hash, not by the node address, so a page is fetched from MangaDex once and then served from
// Cloudflare. Each page fetched from a MangaDex@Home node is reported to api.mangadex.network,
// as their docs require (that's how they spot broken nodes).

const UA = 'mangee/1.0 (+https://mangee.animee.space)';
const YEAR = 31536000;

/** Checks the URL; returns { url, cacheKey, report } or null when it's not a MangaDex image. */
export function parseImageUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search) return null;
  const host = url.hostname;
  const covers = host === 'uploads.mangadex.org' && /^\/covers\/[0-9a-f-]{36}\/[\w.-]+\.(?:jpg|jpeg|png|gif|webp)(?:\.(?:256|512)\.jpg)?$/i.test(url.pathname);
  const page = url.pathname.match(/\/(data|data-saver)\/([0-9a-f]{32})\/([\w.-]+\.(?:jpg|jpeg|png|gif|webp))$/i);
  const node = host === 'uploads.mangadex.org' || /\.mangadex\.network$/.test(host);
  if (covers) return { url: url.toString(), cacheKey: url.toString(), report: false };
  if (page && node) {
    return { url: url.toString(), cacheKey: `https://mdimg.cache/${page[1]}/${page[2]}/${page[3]}`, report: !/mangadex\.org$/.test(host) };
  }
  return null;
}

export async function handleImage(request, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const target = parseImageUrl(new URL(request.url).searchParams.get('u'));
  if (!target) return new Response('Not a MangaDex image', { status: 400 });
  const cache = globalThis.caches?.default;
  const key = new Request(target.cacheKey);
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(target.url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
  } catch {
    if (target.report) report(ctx, { url: target.url, success: false, cached: false, bytes: 0, duration: Date.now() - started });
    return new Response('Image unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const type = upstream.headers.get('Content-Type') || '';
  if (!upstream.ok || !type.startsWith('image/')) {
    if (target.report) report(ctx, { url: target.url, success: false, cached: false, bytes: 0, duration: Date.now() - started });
    // 403/404 from a node usually means its address expired: the reader asks for fresh pages.
    return new Response('Image unavailable', { status: upstream.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = await upstream.arrayBuffer();
  if (target.report) {
    report(ctx, { url: target.url, success: true, cached: /^HIT/i.test(upstream.headers.get('X-Cache') || ''), bytes: body.byteLength, duration: Date.now() - started });
  }
  const response = new Response(body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': `public, max-age=${YEAR}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  });
  if (cache) {
    const put = cache.put(key, response.clone()).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(put);
  }
  return response;
}

function report(ctx, data) {
  const send = fetch('https://api.mangadex.network/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(data),
  }).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(send);
}
