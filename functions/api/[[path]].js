// Tenrai catalogue API with direct multi-provider playback. User accounts remain on D1.
import * as tenrai from '../_lib/providers/tenrai.js';
import { handleAccount } from '../_lib/account.js';
import { importAniList } from '../_lib/importers.js';
import * as megaplay from '../_lib/providers/megaplay.js';
import * as playback from '../_lib/providers/registry.js';
import { proxyStream } from '../_lib/providers/stream-proxy.js';

// Browsers keep API responses for at most 10 minutes, so a deploy reaches everyone quickly.
// The edge cache below keeps its own, longer lifetime.
const BROWSER_MAX_AGE = 600;
const browserCache = ttl => (ttl ? 'public, max-age=' + Math.min(ttl, BROWSER_MAX_AGE) : 'no-store');
const json = (data, status = 200, ttl = 0) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': browserCache(ttl) },
});
async function cached(ctx, ttl, fn) {
  const cache = globalThis.caches?.default;
  const url = new URL(ctx.request.url);
  url.searchParams.set('__cachev', '13');
  const key = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      const response = new Response(hit.body, hit);
      response.headers.set('Cache-Control', browserCache(ttl));
      return response;
    }
  }
  const response = json(await fn(), 200, ttl);
  if (cache) {
    // The edge copy carries the full lifetime; the browser copy gets the short one.
    const edgeCopy = new Response(response.clone().body, response);
    edgeCopy.headers.set('Cache-Control', 'public, max-age=' + ttl);
    const put = cache.put(key, edgeCopy).catch(() => {});
    if (ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return response;
}
const validId = raw => {
  const id = String(raw ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw Object.assign(new Error('Invalid MAL anime ID'), { status: 400 });
  return id;
};
function episodeRef(raw) {
  const decoded = decodeURIComponent(raw || '');
  const match = decoded.match(/^(\d{1,12}):(\d{1,4})$/);
  if (!match) throw Object.assign(new Error('Invalid episode reference'), { status: 400 });
  return { animeId: validId(match[1]), episode: Number(match[2]) };
}

export async function onRequest(ctx) {
  const { request, params } = ctx;
  const url = new URL(request.url);
  const parts = Array.isArray(params.path) ? params.path : String(params.path || '').split('/').filter(Boolean);
  if (parts[0] === 'auth' || parts[0] === 'me') return handleAccount(ctx, parts);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const [a, b, c] = parts;
    if (a === 'stream-proxy' && !b) {
      try { return await proxyStream(request); }
      catch (error) { return json({ error: error?.message || 'Stream proxy failed.' }, error.status || 502); }
    }
    if (a === 'provider' && !b) return json({
      catalogue: { id: 'tenrai', name: 'Tenrai' },
      playback: playback.getProviderList(ctx.env || {}),
    });
    if (a === 'home' && !b) return await cached(ctx, 600, async () => {
      const result = await tenrai.getSeasonalAnime();
      return { recent: result.results, pagination: result.pagination };
    });
    if (a === 'search' && !b) return await cached(ctx, 600, async () => {
      const p = url.searchParams;
      return tenrai.searchAnime({
        query: p.get('q'), page: p.get('page'), type: p.get('type'), status: p.get('status'),
        rating: p.get('rating'), season: p.get('season'), year: p.get('year'), score: p.get('score'),
        genres: p.get('genres') || p.get('genre'), order: p.get('order'),
        letter: p.get('letter'), studio: p.get('studio'),
      });
    });
    if (a === 'list' && b && !c) return await cached(ctx, 1800, async () => tenrai.getList(b, url.searchParams.get('limit')));
    if (a === 'schedule' && !b) return await cached(ctx, 1800, async () => tenrai.getSchedule(url.searchParams.get('day')));
    if (a === 'random' && !b) return json(await tenrai.getRandom());
    if (a === 'import' && b === 'anilist' && !c) return json(await importAniList(url.searchParams.get('user')));
    if (a === 'genres' && !b) return json({ genres: tenrai.GENRES.map(([name]) => name) }, 200, 86400);
    // How many episodes MegaPlay can play in sub and dub (checked against the listed count).
    if (a === 'anime' && b && c === 'availability') return await cached(ctx, 3600, async () => {
      const { total } = await tenrai.getEpisodes(validId(b));
      return megaplay.getAvailability(b, total);
    });
    // Whether one episode plays, for "new episode" badges.
    if (a === 'anime' && b && c === 'available') return await cached(ctx, 1800, async () =>
      megaplay.getEpisodeAvailability(validId(b), url.searchParams.get('ep')));
    if (a === 'anime' && b && c === 'seasons') return await cached(ctx, 86400, async () => tenrai.getSeasons(validId(b)));
    if (a === 'anime' && b && c === 'extras') return await cached(ctx, 3600, async () => tenrai.getExtras(validId(b)));
    if (a === 'anime' && b && !c) return await cached(ctx, 3600, async () => tenrai.getAnime(validId(b)));
    if (a === 'anime' && b && c === 'episodes') return await cached(ctx, 1800, async () => tenrai.getEpisodes(validId(b)));
    if (a === 'episode' && b && c === 'servers') return await cached(ctx, 600, async () => {
      const reference = episodeRef(b);
      // Enforce the catalogue's strict SFW gate even when the API is called directly.
      await tenrai.getAnime(reference.animeId);
      return { episodeId: b, servers: await playback.getServers(reference.animeId, reference.episode, ctx.env || {}) };
    });
    if (a === 'episode' && b && c === 'sources') {
      // Do not edge-cache playback URLs: some providers issue short-lived,
      // request-context-bound stream tokens that must be resolved per viewer.
      const reference = episodeRef(b);
      // A direct playback URL must not bypass the strict SFW catalogue check.
      await tenrai.getAnime(reference.animeId);
      const language = url.searchParams.get('category') === 'dub' ? 'dub' : 'sub';
      const server = url.searchParams.get('server') || 'megaplay';
      const preferred = url.searchParams.get('preferred') || 'megaplay';
      if (server === 'auto') {
        return json(await playback.getFallbackSource(reference.animeId, reference.episode, preferred, language, ctx.env || {}));
      }
      return json({
        episodeId: b,
        ...await playback.getDirectSources(reference.animeId, reference.episode, server, language, ctx.env || {}),
      });
    }
    if (a === 'batch' && !b) return await cached(ctx, 600, async () => {
      const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(id => /^\d{1,12}$/.test(id)))].slice(0, 6);
      const results = [];
      for (const id of ids) {
        try { results.push(await tenrai.getAnime(id)); } catch { /* return the successful portion */ }
      }
      return { results };
    });
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    // Upstream timeouts are a gateway problem, not an Animee crash.
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const status = error.status || (timedOut ? 504 : 500);
    if (status === 500) console.error('Animee API failure', url.pathname, error?.stack || error);
    return json({ error: status === 500 ? 'The anime service had a problem. Try again shortly.' : timedOut && !error.status ? 'An upstream service did not respond in time.' : error.message }, status);
  }
}
