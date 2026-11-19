import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { onRequest } from '../functions/api/[[path]].js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function context(pathAndQuery) {
  const request = new Request('https://animee.test/api/' + pathAndQuery);
  const parts = new URL(request.url).pathname.slice(5).split('/').filter(Boolean);
  return { request, params: { path: parts } };
}
const animeRow = (id, title) => ({
  mal_id: id,
  title,
  title_english: title,
  title_japanese: title,
  images: { jpg: { large_image_url: 'https://images.example/' + id + '.jpg' } },
  type: 'TV',
  status: 'Finished Airing',
  episodes: 12,
  score: 8.5,
  members: 1000,
  rating: 'PG-13 - Teens 13 or older',
  genres: [{ name: 'Action', mal_id: 1 }],
});
const detailPayload = id => ({ data: animeRow(Number(id), 'Sample Anime') });

test('home reads the SFW-filtered seasonal catalogue', async () => {
  globalThis.fetch = async url => {
    assert.match(String(url), /\/seasons\/now/);
    assert.match(String(url), /sfw-strict=true/);
    return Response.json({ data: [animeRow(1, 'Seasonal Sample')], pagination: { current_page: 1, last_visible_page: 1, has_next_page: false } });
  };
  const response = await onRequest(context('home'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.recent[0].title, 'Seasonal Sample');
});

test('search uses the full Tenrai catalogue endpoint, not a recent-feed crawler', async () => {
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.pathname, '/v1/anime');
    assert.equal(parsed.searchParams.get('q'), 'Naruto');
    assert.equal(parsed.searchParams.get('sfw-strict'), 'true');
    return Response.json({ data: [animeRow(20, 'Naruto')], pagination: { current_page: 1, last_visible_page: 4, has_next_page: true, items: { total: 80 } } });
  };
  const response = await onRequest(context('search?q=Naruto'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.results[0].title, 'Naruto');
  assert.equal(body.pageInfo.total, 80);
  assert.equal(body.pageInfo.hasNextPage, true);
});

test('MAL details, episode references, and MegaPlay embeds share one stable ID', async () => {
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/full')) return Response.json(detailPayload(20));
    if (parsed.pathname.endsWith('/episodes')) {
      return Response.json({ data: [{ mal_id: 1, title: 'Episode 1', filler: false }, { mal_id: 2, title: 'Episode 2', filler: true }], pagination: { items: { total: 2 } } });
    }
    throw new Error('Unexpected URL ' + parsed);
  };
  const detail = await onRequest(context('anime/20'));
  assert.equal((await detail.json()).title, 'Sample Anime');
  const episodes = await onRequest(context('anime/20/episodes'));
  const episodeData = await episodes.json();
  assert.equal(episodeData.episodes[1].number, 2);
  assert.equal(episodeData.episodes[1].isFiller, true);
  const servers = await onRequest(context('episode/20%3A2/servers'));
  assert.deepEqual((await servers.json()).servers.map(server => server.category), ['sub', 'dub']);
  const source = await onRequest(context('episode/20%3A2/sources?category=sub'));
  assert.equal((await source.json()).embedUrl, 'https://megaplay.buzz/stream/mal/20/2/sub');
});

test('strict content filtering rejects directly requested mature ratings', async () => {
  globalThis.fetch = async () => Response.json({ data: { ...animeRow(99, 'Hidden Sample'), rating: 'R+ - Mild Nudity' } });
  const response = await onRequest(context('anime/99'));
  assert.equal(response.status, 404);
});
