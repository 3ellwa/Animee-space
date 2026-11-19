import * as anilist from '../_lib/providers/anilist.js';
import { handleAccount } from '../_lib/account.js';

const json = (data, status = 200, ttl = 0) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': ttl ? 'public, max-age=' + ttl : 'no-store',
  },
});

async function cached(ctx, ttl, fn) {
  const cache = globalThis.caches?.default;
  const cacheUrl = new URL(ctx.request.url);
  cacheUrl.searchParams.set('__cachev', '5');
  const key = new Request(cacheUrl.toString(), { method: 'GET' });
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

function decodeEpisodeRef(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw Object.assign(new Error('Invalid episode reference'), { status: 400 });
  }
  const [animeId, episodeNumber, extra] = decoded.split(':');
  if (!animeId || !episodeNumber || extra !== undefined) {
    throw Object.assign(new Error('Invalid episode reference'), { status: 400 });
  }
  return { animeId, episodeNumber };
}

export async function onRequest(ctx) {
  const { request, params } = ctx;
  const url = new URL(request.url);
  const parts = Array.isArray(params.path)
    ? params.path
    : String(params.path || '').split('/').filter(Boolean);

  if (parts[0] === 'auth' || parts[0] === 'me') return handleAccount(ctx, parts);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const [a, b, c] = parts;

    if (a === 'provider' && !b) {
      return json({ name: 'anilist', label: 'AniList / MegaPlay' });
    }

    if (a === 'home' && !b) {
      return await cached(ctx, 300, () => anilist.getHome());
    }

    if (a === 'search' && !b) {
      return await cached(ctx, 300, async () => {
        const page = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), 500);
        const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
        const genre = (url.searchParams.get('genre') || '').trim().slice(0, 50);
        return await anilist.searchAnime({ query, genre, page });
      });
    }

    if (a === 'anime' && b && !c) {
      return await cached(ctx, 300, () => anilist.getAnime(b));
    }

    if (a === 'anime' && b && c === 'episodes') {
      return await cached(ctx, 300, async () => {
        const series = await anilist.getSeries(b);
        return { animeId: series.anime.id, total: series.episodes.length, episodes: series.episodes };
      });
    }

    if (a === 'episode' && b && c === 'servers') {
      return await cached(ctx, 300, async () => {
        const { animeId, episodeNumber } = decodeEpisodeRef(b);
        return {
          episodeId: b,
          servers: await anilist.getServers(animeId, episodeNumber),
        };
      });
    }

    if (a === 'episode' && b && c === 'sources') {
      return await cached(ctx, 300, async () => {
        const { animeId, episodeNumber } = decodeEpisodeRef(b);
        const language = url.searchParams.get('category') === 'dub' ? 'dub' : 'sub';
        return {
          episodeId: b,
          ...await anilist.getSources(animeId, episodeNumber, language),
        };
      });
    }

    if (a === 'batch' && !b) {
      return await cached(ctx, 300, async () => {
        const ids = [...new Set((url.searchParams.get('ids') || '')
          .split(',')
          .filter(id => /^\\d{1,12}$/.test(id)))].slice(0, 8);
        const results = await Promise.all(ids.map(async id => {
          try { return await anilist.getAnime(id); }
          catch { return null; }
        }));
        return { results: results.filter(Boolean) };
      });
    }

    if (a === 'schedule') return json({ items: [], unsupported: true });
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error('Animee API error:', error);
    const message = status === 500 ? 'Internal error' : (error.message || 'Request failed');
    return json({ error: message }, status);
  }
}
