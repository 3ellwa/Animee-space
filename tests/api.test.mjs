import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { onRequest } from '../functions/api/[[path]].js';
import { throttle } from '../functions/_lib/providers/tenrai.js';
import { probeSettings } from '../functions/_lib/providers/megaplay.js';

throttle.gapMs = 0;
probeSettings.gapMs = 0;
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

test('genre browsing is ordered by popularity', async () => {
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get('genres'), '22');
    assert.equal(parsed.searchParams.get('order_by'), 'members');
    assert.equal(parsed.searchParams.get('sort'), 'desc');
    return Response.json({ data: [animeRow(5, 'Romance Sample')], pagination: { current_page: 1, last_visible_page: 1 } });
  };
  const response = await onRequest(context('search?genre=Romance'));
  assert.equal(response.status, 200);
});

test('browse filters pass through only allowed values', async () => {
  globalThis.fetch = async url => {
    const p = new URL(String(url)).searchParams;
    assert.equal(p.get('type'), 'movie');
    assert.equal(p.get('status'), 'complete');
    assert.equal(p.get('rating'), 'pg13');
    assert.equal(p.get('min_score'), '8');
    assert.equal(p.get('genres'), '22,4');
    assert.equal(p.get('order_by'), 'score');
    return Response.json({ data: [], pagination: { current_page: 1, last_visible_page: 1 } });
  };
  const ok = await onRequest(context('search?type=movie&status=complete&rating=pg13&score=8&genres=Romance,Comedy,Hentai&order=score&q=x'));
  assert.equal(ok.status, 200);
  globalThis.fetch = async url => {
    const p = new URL(String(url)).searchParams;
    for (const key of ['type', 'status', 'rating', 'min_score', 'genres']) assert.equal(p.get(key), null, key);
    return Response.json({ data: [], pagination: {} });
  };
  assert.equal((await onRequest(context('search?type=evil&status=x&rating=rx&score=3&genres=Hentai'))).status, 200);
});

test('a misspelled title falls back to close matches', async () => {
  globalThis.fetch = async url => {
    const q = new URL(String(url)).searchParams.get('q');
    if (q === 'frirene') return Response.json({ data: [], pagination: {} });
    assert.equal(q, 'fri');
    return Response.json({ data: [animeRow(1, 'Frieren'), animeRow(2, 'Fruits Basket'), animeRow(3, 'Kaiju No. 8')], pagination: {} });
  };
  const body = await (await onRequest(context('search?q=frirene'))).json();
  assert.equal(body.approximate, true);
  assert.equal(body.results[0].title, 'Frieren');
  assert.ok(!body.results.some(a => a.title === 'Kaiju No. 8'));
});

test('year and season browsing uses seasonal lists ranked by popularity', async () => {
  const seen = [];
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    seen.push(parsed.pathname);
    assert.equal(parsed.searchParams.get('filter'), 'movie');
    return Response.json({ data: [{ ...animeRow(10, 'Small'), members: 5 }, { ...animeRow(11, 'Big'), members: 900 }], pagination: { has_next_page: false } });
  };
  const body = await (await onRequest(context('search?year=2016&season=summer&type=movie'))).json();
  assert.deepEqual(seen, ['/v1/seasons/2016/summer']);
  assert.deepEqual(body.results.map(a => a.title), ['Big', 'Small']);
  assert.equal(body.seasonal, true);
});

test('lists, schedule and extras routes', async () => {
  globalThis.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/v1/top/anime') return Response.json({ data: [animeRow(1, 'Top')] });
    if (parsed.pathname === '/v1/schedules') return Response.json({ data: [{ ...animeRow(2, 'Weekly'), broadcast: { day: 'Fridays', time: '23:00', timezone: 'Asia/Tokyo' } }], pagination: { has_next_page: false } });
    if (parsed.pathname.endsWith('/characters')) return Response.json({ data: [{ role: 'Supporting', character: { name: 'B' } }, { role: 'Main', character: { name: 'A' }, voice_actors: [{ language: 'Japanese', person: { name: 'VA' } }] }] });
    if (parsed.pathname.endsWith('/recommendations')) return Response.json({ data: [{ entry: { mal_id: 9, title: 'Rec' } }] });
    throw new Error('Unexpected URL ' + parsed);
  };
  assert.equal((await (await onRequest(context('list/airing'))).json()).results[0].title, 'Top');
  assert.equal((await onRequest(context('list/nope'))).status, 404);
  const sched = await (await onRequest(context('schedule?day=friday'))).json();
  assert.equal(sched.results[0].broadcast.time, '23:00');
  assert.equal((await onRequest(context('schedule?day=someday'))).status, 400);
  const extras = await (await onRequest(context('anime/5/extras'))).json();
  assert.equal(extras.characters[0].name, 'A');
  assert.equal(extras.characters[0].va.name, 'VA');
  assert.equal(extras.recommendations[0].title, 'Rec');
});

test('seasons follow prequel and sequel links in release order', async () => {
  const shows = {
    101: { title: 'Part Two', aired: { from: '2020-04-01' }, relations: [{ relation: 'Prequel', entry: [{ mal_id: 100, type: 'anime' }] }] },
    100: { title: 'Part One', aired: { from: '2018-01-01' }, relations: [
      { relation: 'Sequel', entry: [{ mal_id: 101, type: 'anime' }] },
      { relation: 'Side Story', entry: [{ mal_id: 102, type: 'anime' }] },
      { relation: 'Adaptation', entry: [{ mal_id: 500, type: 'manga' }] },
      { relation: 'Other', entry: [{ mal_id: 103, type: 'anime' }] },
    ] },
    102: { title: 'Movie', type: 'Movie', aired: { from: '2019-06-01' }, relations: [] },
  };
  globalThis.fetch = async url => {
    const id = new URL(String(url)).pathname.split('/')[3];
    if (!shows[id]) throw new Error('Should not fetch ' + id);
    return Response.json({ data: { ...animeRow(Number(id), shows[id].title), ...shows[id] } });
  };
  const body = await (await onRequest(context('anime/101/seasons'))).json();
  assert.deepEqual(body.seasons.map(s => s.title), ['Part One', 'Movie', 'Part Two']);
});

test('browsers keep API responses for at most 10 minutes', async () => {
  globalThis.fetch = async () => Response.json({ data: { ...animeRow(77, 'Cached'), relations: [] } });
  const seasons = await onRequest(context('anime/77/seasons?v=2'));
  assert.equal(seasons.headers.get('Cache-Control'), 'public, max-age=600');
  const genres = await onRequest(context('genres'));
  assert.equal(genres.headers.get('Cache-Control'), 'public, max-age=600');
  const random = await onRequest(context('random'));
  assert.equal(random.headers.get('Cache-Control'), 'no-store');
});

test('A-Z letter and studio filters reach Tenrai', async () => {
  globalThis.fetch = async url => {
    const p = new URL(String(url)).searchParams;
    assert.equal(p.get('letter'), 'F');
    assert.equal(p.get('order_by'), 'title');
    assert.equal(p.get('sort'), 'asc');
    assert.equal(p.get('producers'), '11');
    return Response.json({ data: [animeRow(3, 'Fairy')], pagination: {} });
  };
  assert.equal((await onRequest(context('search?letter=f&studio=11'))).status, 200);
  globalThis.fetch = async url => {
    const p = new URL(String(url)).searchParams;
    assert.equal(p.get('letter'), null);
    assert.equal(p.get('producers'), null);
    return Response.json({ data: [], pagination: {} });
  };
  assert.equal((await onRequest(context('search?letter=ab&studio=x1'))).status, 200);
});

test('AniList import maps statuses and skips adult or unmatched shows', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://graphql.anilist.co');
    assert.equal(JSON.parse(init.body).variables.user, 'someone');
    return Response.json({ data: { MediaListCollection: { lists: [{ entries: [
      { status: 'COMPLETED', progress: 3, media: { idMal: 1, isAdult: false, episodes: 12, title: { english: 'Done' } } },
      { status: 'CURRENT', progress: 4, media: { idMal: 2, isAdult: false, episodes: 24, title: { romaji: 'Now' } } },
      { status: 'PLANNING', progress: 0, media: { idMal: 3, isAdult: true, title: { english: 'Adult' } } },
      { status: 'PAUSED', progress: 1, media: { idMal: null, isAdult: false, title: { english: 'No MAL' } } },
    ] }] } } });
  };
  const body = await (await onRequest(context('import/anilist?user=someone'))).json();
  assert.deepEqual(body.items.map(i => [i.id, i.status, i.watchedUpTo]), [['1', 'completed', 12], ['2', 'watching', 4]]);
  assert.equal(body.skipped, 2);
  assert.equal((await onRequest(context('import/anilist?user=bad%20name'))).status, 400);
});

test('availability finds the last playable episode per language', async () => {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === 'megaplay.buzz') {
      assert.equal(init.headers.Referer, 'https://animee.space/');
      const [, , , id, ep, lang] = u.pathname.split('/');
      asked.push(lang + ep);
      const last = lang === 'sub' ? 7 : 3;
      return new Response(Number(ep) <= last ? '<title>File 1 - MegaPlay</title>' : '<title>Error - MegaPlay</title>');
    }
    if (u.pathname.endsWith('/full')) return Response.json({ data: { ...animeRow(4242, 'Probe'), episodes: 12 } });
    if (u.pathname.endsWith('/episodes')) return Response.json({ data: [], pagination: { last_visible_page: 1 } });
    throw new Error('Unexpected ' + u);
  };
  const body = await (await onRequest(context('anime/4242/availability'))).json();
  assert.deepEqual([body.sub, body.dub], [7, 3]);
  assert.ok(asked.length < 16, 'binary search, not one request per episode: ' + asked.length);
  const one = await (await onRequest(context('anime/4242/available?ep=5'))).json();
  assert.deepEqual([one.sub, one.dub], [true, false]);
});

test('episode lists fetch every page so long shows keep names and filler flags', async () => {
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/full')) return Response.json({ data: { ...animeRow(4343, 'Long'), episodes: 150 } });
    const page = Number(u.searchParams.get('page'));
    const from = (page - 1) * 100 + 1;
    const count = page === 1 ? 100 : 50;
    return Response.json({ data: Array.from({ length: count }, (_, i) => ({ mal_id: from + i, title: 'Ep ' + (from + i), filler: from + i > 120 })), pagination: { last_visible_page: 2 } });
  };
  const body = await (await onRequest(context('anime/4343/episodes'))).json();
  assert.equal(body.episodes.length, 150);
  assert.equal(body.episodes[149].title, 'Ep 150');
  assert.equal(body.episodes.filter(e => e.isFiller).length, 30);
});

test('romaji and Japanese titles stay separate', async () => {
  globalThis.fetch = async () => Response.json({ data: { ...animeRow(7, 'Frieren'), title: 'Sousou no Frieren', title_japanese: '葬送のフリーレン' } });
  const body = await (await onRequest(context('anime/7'))).json();
  assert.equal(body.titleRomaji, 'Sousou no Frieren');
  assert.equal(body.titleNative, '葬送のフリーレン');
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
