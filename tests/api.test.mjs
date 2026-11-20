import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { onRequest } from '../functions/api/[[path]].js';
import { throttle } from '../functions/_lib/providers/tenrai.js';
import { probeSettings } from '../functions/_lib/providers/megaplay.js';
import { getProviderList, getServers, getSources, getFallbackSource, playbackLimits, resetProviderHealth } from '../functions/_lib/providers/registry.js';

throttle.gapMs = 0;
probeSettings.gapMs = 0;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; resetProviderHealth(); });

function context(pathAndQuery, env = {}) {
  const request = new Request('https://animee.test/api/' + pathAndQuery);
  const parts = new URL(request.url).pathname.slice(5).split('/').filter(Boolean);
  return { request, env, params: { path: parts } };
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
    assert.equal(q, 'fr');
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
  assert.deepEqual((await servers.json()).servers.map(server => server.category), ['sub', 'dub', 'sub']);
  const source = await onRequest(context('episode/20%3A2/sources?category=sub'));
  assert.equal((await source.json()).embedUrl, 'https://megaplay.buzz/stream/mal/20/2/sub');
});


test('playback registry returns real provider IDs and routes sources to the selected provider', async () => {
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(4242));
    throw new Error('Unexpected URL ' + target);
  };
  const env = {
    ANIMEE_EMBED_PROVIDERS: JSON.stringify([
      {
        id: 'backup-one',
        name: 'Backup One',
        embedUrlTemplate: 'https://embed.example/watch/{malId}/{episode}?audio={category}',
        categories: ['sub', 'dub'],
      },
      {
        id: 'backup-two',
        name: 'Backup Two',
        embedUrlTemplate: 'https://player.example/{malId}/{episode}/{category}',
        categories: ['sub'],
      },
    ]),
  };
  const servers = await (await onRequest(context('episode/4242%3A3/servers', env))).json();
  assert.deepEqual(
    servers.servers.map(s => [s.id, s.name, s.category]),
    [
      ['megaplay', 'MegaPlay', 'sub'],
      ['megaplay', 'MegaPlay', 'dub'],
      ['animeparadise', 'AnimeParadise', 'sub'],
      ['backup-one', 'Backup One', 'sub'],
      ['backup-one', 'Backup One', 'dub'],
      ['backup-two', 'Backup Two', 'sub'],
    ],
  );

  const selected = await onRequest(context('episode/4242%3A3/sources?server=backup-two&category=sub', env));
  const source = await selected.json();
  assert.equal(source.embedUrl, 'https://player.example/4242/3/sub');
  assert.equal(source.embedOrigin, 'https://player.example');
  assert.equal(source.provider, 'backup-two');

  const invalid = await onRequest(context('episode/4242%3A3/sources?server=not-configured&category=sub', env));
  assert.equal(invalid.status, 404);
});

test('provider configuration rejects non-HTTPS embeds and duplicate IDs', async () => {
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(4242));
    throw new Error('Unexpected URL ' + target);
  };
  const insecure = context('episode/4242%3A1/servers', {
    ANIMEE_EMBED_PROVIDERS: JSON.stringify([{ id: 'bad', name: 'Bad', embedUrlTemplate: 'http://bad.example/{malId}', categories: ['sub'] }]),
  });
  assert.equal((await onRequest(insecure)).status, 500);
  const duplicate = context('episode/4242%3A1/servers', {
    ANIMEE_EMBED_PROVIDERS: JSON.stringify([{ id: 'megaplay', name: 'Fake', embedUrlTemplate: 'https://fake.example/{malId}', categories: ['sub'] }]),
  });
  assert.equal((await onRequest(duplicate)).status, 500);
});

test('strict content filtering rejects directly requested mature ratings', async () => {
  globalThis.fetch = async () => Response.json({ data: { ...animeRow(99, 'Hidden Sample'), rating: 'R+ - Mild Nudity' } });
  const response = await onRequest(context('anime/99'));
  assert.equal(response.status, 404);
});


test('built-in playback providers require no optional backend configuration', async () => {
  const providers = getProviderList({});
  assert.deepEqual(providers.map(provider => provider.id), ['megaplay', 'animeparadise']);
  const servers = await getServers('20', 1, {});
  assert.deepEqual(servers.map(server => [server.id, server.category]), [
    ['megaplay', 'sub'], ['megaplay', 'dub'], ['animeparadise', 'sub'],
  ]);
  assert.ok(!providers.some(provider => provider.id === 'anikoto'), 'Anikoto playback uses MegaPlay and is not counted as an independent source');
});

test('AnimeParadise resolves episode sources through its own REST API', async () => {
  const { getSources: getAnimeParadiseSources } = await import('../functions/_lib/providers/animeparadise.js');
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(62001));
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/search') {
      assert.equal(target.searchParams.get('q'), 'Sample Anime');
      return Response.json({ data: [{ _id: 'ap-show', title: 'Sample Anime', year: 2020 }] });
    }
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/anime/ap-show/episode') {
      return Response.json({ data: [{ uid: 'ap-episode-1', number: '1', title: 'Episode 1' }] });
    }
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/ep/ap-episode-1') {
      assert.equal(target.searchParams.get('origin'), 'ap-show');
      return Response.json({ data: { episode: { streamLink: 'signed-stream-token', subData: [{ url: 'https://subs.example/en.vtt', label: 'English', lang: 'en' }] } } });
    }
    throw new Error('Unexpected URL ' + target);
  };
  const result = await getAnimeParadiseSources('62001', 1, 'sub');
  assert.equal(result.language, 'sub');
  assert.match(result.sources[0].url, /^\/api\/stream-proxy\?provider=animeparadise&url=/);
  assert.equal(result.tracks[0].lang, 'en');
});

test('automatic fallback tries providers sequentially when earlier providers fail', async () => {
  const id = '62003';
  const calls = [];
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    calls.push(target.toString());
    if (target.hostname === 'megaplay.buzz') return new Response('<title>Error - MegaPlay</title>');
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(Number(id)));
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/search') {
      return Response.json({ data: [{ _id: 'ap-show', title: 'Sample Anime', year: 2020 }] });
    }
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/anime/ap-show/episode') {
      return Response.json({ data: [{ uid: 'ap-episode-1', number: '1' }] });
    }
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/ep/ap-episode-1') {
      return Response.json({ data: { episode: { streamLink: 'signed-stream-token' } } });
    }
    throw new Error('Unexpected URL ' + target);
  };
  const result = await getFallbackSource(id, 1, 'megaplay', 'sub', {});
  assert.equal(result.provider, 'animeparadise');
  assert.equal(result.fallback, true);
  assert.match(result.sources[0].url, /^\/api\/stream-proxy\?provider=animeparadise/);
  const hosts = calls.map(value => new URL(value).hostname);
  assert.ok(hosts.indexOf('megaplay.buzz') < hosts.indexOf('api.animeparadise.moe'));
  const count = calls.length;
  const retried = await getFallbackSource(id, 1, 'megaplay', 'sub', {});
  assert.equal(retried.provider, 'animeparadise');
  assert.notEqual(retried.cached, true, 'expiring direct streams must be resolved again');
  assert.ok(calls.length > count, 'provider stream URLs are re-resolved instead of being reused');
});

test('automatic fallback caches stable MegaPlay embed resolutions', async () => {
  const id = '62004';
  let probes = 0;
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'megaplay.buzz') { probes++; return new Response('<title>File 1 - MegaPlay</title>'); }
    throw new Error('Unexpected URL ' + target);
  };
  const first = await getFallbackSource(id, 1, 'megaplay', 'sub', {});
  assert.equal(first.provider, 'megaplay');
  const second = await getFallbackSource(id, 1, 'megaplay', 'sub', {});
  assert.equal(second.cached, true);
  assert.equal(probes, 1);
});

test('AnimeParadise HLS proxy rewrites same-provider manifest URLs and rejects other hosts', async () => {
  const targetUrl = 'https://stream.animeparadise.moe/master.m3u8';
  globalThis.fetch = async url => {
    assert.equal(String(url), targetUrl);
    return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment-1.ts\n', {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    });
  };
  const response = await onRequest(context('stream-proxy?provider=animeparadise&url=' + encodeURIComponent(targetUrl)));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/stream-proxy\?provider=animeparadise/);
  assert.match(body, /key\.bin/);

  const blocked = await onRequest(context('stream-proxy?provider=animeparadise&url=' + encodeURIComponent('https://evil.example/master.m3u8')));
  assert.equal(blocked.status, 403);
});

test('direct playback routes enforce SFW filtering and source responses are not cached', async () => {
  let playbackTouched = false;
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) {
      return Response.json({ data: { ...animeRow(62005, 'Hidden Sample'), rating: 'R+ - Mild Nudity' } });
    }
    playbackTouched = true;
    throw new Error('Playback must not be attempted for filtered titles: ' + target);
  };
  const blocked = await onRequest(context('episode/62005%3A1/sources?server=auto&category=sub'));
  assert.equal(blocked.status, 404);
  assert.equal(playbackTouched, false);

  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(62006));
    if (target.hostname === 'megaplay.buzz') return new Response('<title>File 2 - MegaPlay</title>');
    throw new Error('Unexpected URL ' + target);
  };
  const response = await onRequest(context('episode/62006%3A1/sources?server=auto&category=sub'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('automatic playback route returns the first working source', async () => {
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(31));
    if (target.hostname === 'megaplay.buzz') return new Response('<title>File 1 - MegaPlay</title>');
    throw new Error('Unexpected URL ' + target);
  };
  const response = await onRequest(context('episode/31%3A2/sources?server=auto&preferred=megaplay&category=sub'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.provider, 'megaplay');
  assert.equal(body.embedUrl, 'https://megaplay.buzz/stream/mal/31/2/sub');
});

test('a hanging provider is cut off by the deadline and reported as 504', async () => {
  const saved = { ...playbackLimits };
  playbackLimits.providerMs = 50;
  try {
    globalThis.fetch = async url => {
      const target = new URL(String(url));
      if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(62010));
      return new Promise(() => {}); // never answers
    };
    const response = await onRequest(context('episode/62010%3A1/sources?server=animeparadise&category=sub'));
    assert.equal(response.status, 504);
    assert.match((await response.json()).error, /AnimeParadise/);
  } finally {
    Object.assign(playbackLimits, saved);
  }
});

test('a provider that keeps failing is skipped instead of retried on every episode', async () => {
  let paradiseCalls = 0;
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(62011));
    if (target.hostname === 'api.animeparadise.moe') { paradiseCalls++; return new Response('down', { status: 522 }); }
    if (target.hostname === 'megaplay.buzz') return new Response('<title>File 1 - MegaPlay</title>');
    throw new Error('Unexpected URL ' + target);
  };
  for (let ep = 1; ep <= 3; ep++) {
    const result = await getFallbackSource('62011', ep, 'animeparadise', 'sub', {});
    assert.equal(result.provider, 'megaplay');
  }
  const afterTrip = paradiseCalls;
  const result = await getFallbackSource('62011', 4, 'animeparadise', 'sub', {});
  assert.equal(result.provider, 'megaplay');
  assert.equal(paradiseCalls, afterTrip, 'a tripped provider is not contacted');
});

test('an episode a provider simply lacks does not trip its breaker', async () => {
  let searches = 0;
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    if (target.hostname === 'api.tenrai.org' && target.pathname.endsWith('/full')) return Response.json(detailPayload(62012));
    if (target.hostname === 'api.animeparadise.moe' && target.pathname === '/search') {
      searches++;
      return Response.json({ data: [{ _id: 'ap-show', title: 'Sample Anime', year: 2020 }] });
    }
    if (target.hostname === 'api.animeparadise.moe') return Response.json({ data: [] });
    if (target.hostname === 'megaplay.buzz') return new Response('<title>File 1 - MegaPlay</title>');
    throw new Error('Unexpected URL ' + target);
  };
  for (let ep = 1; ep <= 4; ep++) await getFallbackSource('62012', ep, 'animeparadise', 'sub', {});
  assert.equal(searches, 4);
});

test('a misspelled search puts close matches ahead of unrelated results', async () => {
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    const q = target.searchParams.get('q');
    if (target.pathname.endsWith('/anime') && q === 'frerien') return Response.json({ data: [animeRow(1, 'Free!')] });
    if (target.pathname.endsWith('/anime') && q === 'fr') {
      return Response.json({ data: [animeRow(2, 'Fruits Basket'), animeRow(3, "Frieren: Beyond Journey's End")] });
    }
    throw new Error('Unexpected URL ' + target);
  };
  const response = await onRequest(context('search?q=frerien'));
  const body = await response.json();
  assert.equal(body.results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(body.approximate, true);
  assert.ok(body.results.some(anime => anime.title === 'Free!'), 'original results are kept after the close matches');
});

test('an exact search does not trigger the close-match lookup', async () => {
  const queries = [];
  globalThis.fetch = async url => {
    const target = new URL(String(url));
    queries.push(target.searchParams.get('q'));
    return Response.json({ data: [animeRow(4, 'One Piece')] });
  };
  await onRequest(context('search?q=one%20piece&page=1&type=&nocache=' + Date.now()));
  assert.deepEqual(queries, ['one piece']);
});
