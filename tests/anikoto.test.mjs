import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getRecentAnime, getSeries, getServers, getSources } from '../functions/_lib/providers/anikoto.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('reads the paginated catalog data envelope and maps basic card fields', async () => {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /recent-anime\?page=1&per_page=20/);
    return Response.json({
      ok: true,
      pagination: { current_page: 1, total_pages: 2, has_next: true },
      data: [{
        id: 'sample-anime-77',
        name: 'Sample Anime',
        poster: 'https://images.example/poster.jpg',
        type: 'TV',
        episodes: { sub: 12, dub: 4 },
        terms_by_type: { genre: ['Action', 'Adventure'] },
      }],
    });
  };

  const result = await getRecentAnime({ page: 1, perPage: 20 });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, 'sample-anime-77');
  assert.equal(result.results[0].title, 'Sample Anime');
  assert.equal(result.results[0].cover, 'https://images.example/poster.jpg');
  assert.deepEqual(result.results[0].genres, ['Action', 'Adventure']);
  assert.equal(result.pagination.total_pages, 2);
});

test('reads series data.episodes and creates real MegaPlay episode embeds', async () => {
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://anikotoapi.site/series/sample-series-88');
    return Response.json({
      ok: true,
      data: {
        anime: {
          id: 'sample-series-88',
          name: 'Sample Series',
          poster: 'https://images.example/series.jpg',
          terms_by_type: { genre: ['Comedy'] },
        },
        episodes: [
          {
            number: 1,
            episode_embed_id: '835403',
            embed_url: {
              sub: 'https://megaplay.buzz/stream/s-2/835403/sub',
              dub: 'https://megaplay.buzz/stream/s-2/835403/dub',
            },
          },
          {
            number: 2,
            episode_embed_id: '835404',
            embed_url: { sub: 'https://megaplay.buzz/stream/s-2/835404/sub' },
          },
        ],
      },
    });
  };

  const series = await getSeries('sample-series-88');
  assert.equal(series.anime.id, 'sample-series-88');
  assert.equal(series.anime.title, 'Sample Series');
  assert.equal(series.episodes.length, 2);
  assert.equal(series.episodes[0].id, 'sample-series-88:835403');
  assert.deepEqual((await getServers('sample-series-88', '835403')).map(x => x.category), ['sub', 'dub']);
  assert.deepEqual((await getServers('sample-series-88', '835404')).map(x => x.category), ['sub']);
  assert.equal(
    (await getSources('sample-series-88', '835403', 'dub')).embedUrl,
    'https://megaplay.buzz/stream/s-2/835403/dub',
  );
  assert.equal(
    (await getSources('sample-series-88', '835404', 'sub')).embedUrl,
    'https://megaplay.buzz/stream/s-2/835404/sub',
  );
});

test('rejects unsafe series identifiers', async () => {
  await assert.rejects(() => getSeries('../not-a-series'), { status: 400 });
});

test('reports upstream rate limiting rather than returning an empty catalog', async () => {
  globalThis.fetch = async () => new Response('Too many requests', { status: 429 });
  await assert.rejects(() => getRecentAnime(), { status: 429 });
});
