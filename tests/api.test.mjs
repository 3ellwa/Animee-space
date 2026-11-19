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

const anime = (id, name) => ({
  id, name, poster: 'https://images.example/' + id + '.jpg', type: 'TV',
  episodes: { sub: 12, dub: 6 }, terms_by_type: { genre: ['Action'] },
});
const seriesPayload = id => ({
  ok: true,
  data: {
    anime: anime(id, 'Playable Sample'),
    episodes: [{
      number: 1,
      episode_embed_id: '123456',
      embed_url: {
        sub: 'https://megaplay.buzz/stream/s-2/123456/sub',
        dub: 'https://megaplay.buzz/stream/s-2/123456/dub',
      },
    }],
  },
});

test('homepage returns a single recent-updates row set, not duplicate trend/popularity rows', async () => {
  globalThis.fetch = async () => Response.json({
    ok: true,
    pagination: { current_page: 1, total_pages: 2, has_next: true },
    data: [anime('recent-1', 'Recent One')],
  });
  const response = await onRequest(context('home'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.recent[0].title, 'Recent One');
  assert.equal('trending' in body, false);
  assert.equal('popular' in body, false);
});

test('title search scans later Anikoto pages instead of searching only page one', async () => {
  const requestedPages = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    const page = Number(parsed.searchParams.get('page'));
    requestedPages.push(page);
    return Response.json({
      ok: true,
      pagination: { current_page: page, total_pages: 2, has_next: page === 1 },
      data: [page === 1 ? anime('unrelated-1', 'Nothing Like It') : anime('target-series', 'Target Search Result')],
    });
  };
  const response = await onRequest(context('search?q=Target'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(body.results[0].id, 'target-series');
  assert.equal(body.pageInfo.total, 1);
});

test('series detail and episode routes preserve provider IDs and playable embed IDs', async () => {
  globalThis.fetch = async () => Response.json(seriesPayload('playable-series-33'));

  const detail = await onRequest(context('anime/playable-series-33'));
  const detailBody = await detail.json();
  assert.equal(detail.status, 200);
  assert.equal(detailBody.title, 'Playable Sample');

  const episodeList = await onRequest(context('anime/playable-series-33/episodes'));
  const episodeBody = await episodeList.json();
  assert.equal(episodeList.status, 200);
  assert.equal(episodeBody.episodes[0].id, 'playable-series-33:123456');

  const servers = await onRequest(context('episode/playable-series-33%3A123456/servers'));
  const serversBody = await servers.json();
  assert.deepEqual(serversBody.servers.map(x => x.category), ['sub', 'dub']);

  const source = await onRequest(context('episode/playable-series-33%3A123456/sources?category=sub'));
  const sourceBody = await source.json();
  assert.equal(sourceBody.embedUrl, 'https://megaplay.buzz/stream/s-2/123456/sub');
});
