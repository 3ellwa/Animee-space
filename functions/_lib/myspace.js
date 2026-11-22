// my.animee.space: the download page for the my space desktop app (desktop/).
//
//   /              the page (public/sites/my/index.html, its my.css and my.js)
//   /latest.json   newest release: { version, size, url, published } or { version: null }
//   /download      straight to the newest installer on GitHub (or back to / if none yet)
//
// Releases live on GitHub (3ellwa/Animee-space); the answer is kept at the edge 10 minutes.

export const REPO = '3ellwa/Animee-space';
export const INSTALLER = 'my-space-setup.exe';

/** The newest release's installer, from the GitHub API answer. */
export function pickRelease(json) {
  const asset = (json?.assets || []).find((a) => a.name === INSTALLER);
  if (!asset) return { version: null };
  return {
    version: String(json.tag_name || json.name || '').replace(/^v/, '') || null,
    size: asset.size || null,
    url: asset.browser_download_url,
    published: json.published_at || null,
  };
}

export async function latestRelease(ctx) {
  const cache = globalThis.caches?.default;
  const key = new Request('https://my.animee.space/__latest?v=1');
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit.json();
  let info = { version: null };
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'animee-space', Accept: 'application/vnd.github+json' },
    });
    if (res.ok) info = pickRelease(await res.json());
    else if (res.status !== 404) throw new Error(`GitHub ${res.status}`);
  } catch {
    return { version: null, unavailable: true }; // try again next time, don't cache a failure
  }
  if (cache) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(info), { headers: { 'Cache-Control': 'public, max-age=600', 'Content-Type': 'application/json' } })).catch(() => {}));
  return info;
}

/** Answers every request on my.animee.space. `file(key, site)` serves a bundled file. */
export async function handleMy(request, url, ctx, file) {
  const json = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
  if (url.pathname === '/latest.json') return json(await latestRelease(ctx));
  if (url.pathname === '/download') {
    const r = await latestRelease(ctx);
    return Response.redirect(r.url || 'https://my.animee.space/', 302);
  }
  if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const key = url.pathname === '/' ? '/index.html' : url.pathname;
  if (key.startsWith('/sites/')) return null;
  // The page and its own files, plus the shared fonts.
  if (key === '/index.html' || key === '/my.css' || key === '/my.js' || key === '/og.png' || key.startsWith('/icons/') || key.startsWith('/fonts/')) {
    return file(key, 'my', request);
  }
  return null;
}
