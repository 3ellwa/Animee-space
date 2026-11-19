import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getHome, searchAnime, getAnime, getSeries, getServers, getSources } from '../functions/_lib/providers/anilist.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const media = (id, extra = {}) => ({
  id,
  idMal: 20_000 + id,
  title: { english: 'Sample Anime', romaji: 'Sample Anime', native: 'サンプル' },
  coverImage: { extraLarge: 'https://images.example/' + id + '.jpg', large: null, medium: null, color: '#7766aa' },
  bannerImage: 'https://images.example/' + id + '-banner.jpg',
  format: 'TV',
  status: 'FINISHED',
  episodes: 3,
  duration: 24,
  season: 'SPRING',
  seasonYear: 2025,
  averageScore: 85,
  popularity: 12000,
  genres: ['Action', 'Adventure'],
  description: 'A sample description.',
  isAdult: false,
  startDate: { year: 2025, month: 4, day: 1 },
  endDate: { year: 2025, month: 6, day: 1 },
  nextAiringEpisode: null,
  studios: { nodes: [{ name: 'Sample Studio' }] },
  source: 'MANGA',
  synonyms: ['Sample'],
  trailer: { id: 'abc123', site: 'youtube' },
  ...extra,
});

function responseFor(body, data) {
  assert.equal(body.query.includes('isAdult: false'), true, 'catalogue query must exclude adult entries');
  return Response.json({ data });
}

test('homepage requests AniList trending media and normalizes card fields', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.query, /TRENDING_DESC/);
    return responseFor(body, {
      Page: {
        pageInfo: { currentPage: 1, lastPage: 5, hasNextPage: true, total: 100 },
        media: [media(101)],
      },
    });
  };

  const result = await getHome();
  assert.equal(result.recent[0].id, '101');
  assert.equal(result.recent[0].title, 'Sample Anime');
  assert.equal(result.recent[0].score, 85);
  assert.deepEqual(result.recent[0].studios, ['Sample Studio']);
});

test('title search uses AniList search and filters adult entries', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.variables.search, 'Naruto');
    assert.match(body.query, /SEARCH_MATCH/);
    return Response.json({
      data: {
        Page: {
          pageInfo: { currentPage: 1, lastPage: 2, hasNextPage: true, total: 30 },
          media: [
            media(102, { title: { english: 'Naruto', romaji: 'Naruto', native: 'ナルト' } }),
            media(103, { isAdult: true, title: { english: 'Adult result', romaji: 'Adult result', native: '' } }),
          ],
        },
      },
    });
  };

  const result = await searchAnime({ query: 'Naruto', page: 1 });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, 'Naruto');
  assert.equal(result.pageInfo.total, 30);
});

test('details reject adult titles even when a direct ID is supplied', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return Response.json({ data: { Media: media(104, { isAdult: true }) } });
  };

  await assert.rejects(() => getAnime('104'), { status: 404 });
});

test('episode list uses AniList ID and returns MegaPlay AniList embeds', async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return Response.json({ data: { Media: media(105) } });
  };

  const series = await getSeries('105');
  assert.equal(series.episodes.length, 3);
  assert.equal(series.episodes[1].number, 2);
  assert.deepEqual((await getServers('105', '2')).map(server => server.category), ['sub', 'dub']);
  assert.equal(
    (await getSources('105', '2', 'sub')).embedUrl,
    'https://megaplay.buzz/stream/ani/105/2/sub',
  );
  assert.equal(
    (await getSources('105', '2', 'dub')).embedUrl,
    'https://megaplay.buzz/stream/ani/105/2/dub',
  );
});

test('invalid AniList identifiers are rejected before any upstream request', async () => {
  await assert.rejects(() => getAnime('../not-an-id'), { status: 400 });
});
