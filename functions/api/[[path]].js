// All /api/* routes for animee (Cloudflare Pages Functions).
//
//   GET /api/provider                         which video provider is active
//   GET /api/home                             spotlight + home rows
//   GET /api/search?q=&genre=&year=&season=&format=&status=&sort=&page=
//   GET /api/anime/:id                        full details
//   GET /api/anime/:id/episodes               episode list (from provider)
//   GET /api/episode/:episodeId/servers       servers (sub/dub)
//   GET /api/episode/:episodeId/sources?server=&category=
//   GET /api/schedule?start=&end=             airing schedule between unix timestamps

//   GET /api/batch?ids=1,2,3                  small cards for many ids (watchlist / history on a new device)
//   /api/auth/* and /api/me/*                 accounts + sync (see _lib/account.js)

import { getHome, searchAnime, getAnime, getSchedule, getMany } from '../_lib/anilist.js';
import { getProvider } from '../_lib/providers/index.js';
import { handleAccount } from '../_lib/account.js';

const json = (data, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

// Edge-cache successful responses so AniList's rate limit isn't hit
async function cached(context, ttl, produce) {
  let cache = null;
  try { cache = globalThis.caches?.default || null; } catch { cache = null; }
  const key = new Request(new URL(context.request.url).toString(), { method: 'GET' });

  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const res = json(await produce(), 200, ttl);
  if (cache) {
    const put = cache.put(key, res.clone()).catch(() => {});
    context.waitUntil ? context.waitUntil(put) : await put;
  }
  return res;
}

const toId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || '').split('/').filter(Boolean);

  if (parts[0] === 'auth' || parts[0] === 'me') return handleAccount(context, parts);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const provider = getProvider(env);

  try {
    const [a, b, c] = parts;

    if (a === 'provider' && !b) return json({ name: provider.name, label: provider.label });

    if (a === 'anikoto' && b === 'recent-anime' && !c) {
      const page = Math.min(Math.max(parseInt(url.searchParams.get('page'), 10) || 1, 1), 500);
      const perPage = Math.min(Math.max(parseInt(url.searchParams.get('per_page'), 10) || 20, 1), 50);
      return await cached(context, 300, () => provider.getRecentAnime({ page, perPage }));
    }

    if (a === 'anikoto' && b === 'series' && c && parts.length === 3) {
      return await cached(context, 600, () => provider.getSeries(c));
    }

    if (a === 'anikoto' && b === 'embed' && c && parts.length === 4) {
      const language = parts[3] === 'dub' ? 'dub' : parts[3] === 'sub' ? 'sub' : null;
      if (!language || !/^\d+$/.test(c)) return json({ error: 'Invalid embed id or language' }, 400);
      return json({ embedUrl: `https://megaplay.buzz/stream/s-2/${encodeURIComponent(c)}/${language}` });
    }

    if (a === 'home' && !b) return await cached(context, 600, getHome);

    if (a === 'search' && !b) return await cached(context, 300, () => searchAnime(url.searchParams));

    if (a === 'anime' && b && !c) return await cached(context, 3600, () => getAnime(toId(b)));

    if (a === 'anime' && b && c === 'episodes' && parts.length === 3) {
      return await cached(context, 600, async () => {
        const anime = await getAnime(toId(b));
        const episodes = await provider.getEpisodes(anime, env);
        return { animeId: anime.id, total: episodes.length, episodes };
      });
    }

    if (a === 'episode' && b && c === 'servers' && parts.length === 3) {
      return json({ episodeId: b, servers: await provider.getServers(b, env) });
    }

    if (a === 'episode' && b && c === 'sources' && parts.length === 3) {
      const server = url.searchParams.get('server') || undefined;
      const category = url.searchParams.get('category') === 'dub' ? 'dub' : 'sub';
      // never cached: real providers often return short-lived signed URLs
      return json({ episodeId: b, ...(await provider.getSources(b, { server, category }, env)) });
    }

    if (a === 'batch' && !b) {
      const ids = [...new Set((url.searchParams.get('ids') || '').split(',').map(Number)
        .filter((n) => Number.isInteger(n) && n > 0))].slice(0, 50).sort((x, y) => x - y);
      if (!ids.length) return json({ results: [] });
      return await cached(context, 3600, () => getMany(ids));
    }

    if (a === 'schedule' && !b) {
      const now = Math.floor(Date.now() / 1000);
      let start = parseInt(url.searchParams.get('start'), 10);
      let end = parseInt(url.searchParams.get('end'), 10);
      if (!Number.isFinite(start)) start = now - 3600;
      if (!Number.isFinite(end) || end <= start) end = start + 86400;
      if (end - start > 8 * 86400) end = start + 8 * 86400;
      return await cached(context, 600, () => getSchedule(start, end));
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json({ error: status === 500 ? 'Internal error' : err.message }, status);
  }
}
