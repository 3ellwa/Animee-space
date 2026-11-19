// Tenrai catalogue API with MegaPlay embeds. User accounts remain on D1.
import * as tenrai from '../_lib/providers/tenrai.js';
import { handleAccount } from '../_lib/account.js';

const json = (data, status = 200, ttl = 0) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': ttl ? 'public, max-age=' + ttl : 'no-store' },
});
async function cached(ctx, ttl, fn) {
  const cache = globalThis.caches?.default;
  const url = new URL(ctx.request.url);
  url.searchParams.set('__cachev', '5');
  const key = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const response = json(await fn(), 200, ttl);
  if (cache) {
    const put = cache.put(key, response.clone()).catch(() => {});
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
    if (a === 'provider' && !b) return json({ name: 'tenrai', label: 'Tenrai / MegaPlay' });
    if (a === 'home' && !b) return await cached(ctx, 600, async () => {
      const result = await tenrai.getSeasonalAnime();
      return { recent: result.results, pagination: result.pagination };
    });
    if (a === 'search' && !b) return await cached(ctx, 600, async () => {
      const page = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), 200);
      const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
      const genre = (url.searchParams.get('genre') || '').trim().slice(0, 50);
      const result = await tenrai.searchAnime({ query, genre, page });
      return { results: result.results, pageInfo: result.pageInfo };
    });
    if (a === 'anime' && b && !c) return await cached(ctx, 3600, async () => tenrai.getAnime(validId(b)));
    if (a === 'anime' && b && c === 'episodes') return await cached(ctx, 1800, async () => tenrai.getEpisodes(validId(b)));
    if (a === 'episode' && b && c === 'servers') return await cached(ctx, 600, async () => {
      const reference = episodeRef(b);
      return { episodeId: b, servers: await tenrai.getServers(reference.animeId, reference.episode) };
    });
    if (a === 'episode' && b && c === 'sources') return await cached(ctx, 600, async () => {
      const reference = episodeRef(b);
      const language = url.searchParams.get('category') === 'dub' ? 'dub' : 'sub';
      return { episodeId: b, ...await tenrai.getSources(reference.animeId, reference.episode, language) };
    });
    if (a === 'batch' && !b) return await cached(ctx, 600, async () => {
      const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(id => /^\d{1,12}$/.test(id)))].slice(0, 6);
      const results = [];
      for (const id of ids) {
        try { results.push(await tenrai.getAnime(id)); } catch { /* return the successful portion */ }
      }
      return { results };
    });
    if (a === 'schedule') return json({ items: [], unsupported: true });
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('Animee API failure', url.pathname, error?.stack || error);
    return json({ error: status === 500 ? 'The anime service had a problem. Try again shortly.' : error.message }, status);
  }
}
