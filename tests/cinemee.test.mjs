import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import * as tmdb from '../functions/_lib/providers/tmdb.js';
import { siteOf, siteEnv, brandShell } from '../functions/_lib/site.js';

const env = { SITE: 'cinemee', TMDB_TOKEN: 'test-token' };
const context = (pathAndQuery) => {
  const request = new Request('https://cinemee.animee.space/api/' + pathAndQuery);
  return { request, env, params: { path: new URL(request.url).pathname.slice(5).split('/').filter(Boolean) } };
};

// A tiny fake TMDB: Fight Club (movie 550) and a two-season show (tv 1399) whose
// second season is still airing (its last episode is in the future).
const FIGHT_CLUB = {
  id: 550, title: 'Fight Club', original_title: 'Fight Club', release_date: '1999-10-15', status: 'Released',
  runtime: 139, vote_average: 8.4, vote_count: 30000, overview: 'An insomniac office worker…',
  poster_path: '/p.jpg', backdrop_path: '/b.jpg', genres: [{ id: 18, name: 'Drama' }],
  production_companies: [{ name: 'Fox 2000 Pictures' }],
  videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'abc123', official: true }] },
  credits: { cast: [{ name: 'Edward Norton', character: 'Narrator', profile_path: '/en.jpg' }] },
  recommendations: { results: [{ id: 680, title: 'Pulp Fiction', release_date: '1994-09-10', media_type: 'movie' }] },
  release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R' }] }] },
};
const SHOW = {
  id: 1399, name: 'Game of Thrones', first_air_date: '2011-04-17', status: 'Returning Series', number_of_episodes: 5, number_of_seasons: 2,
  episode_run_time: [60], vote_average: 8.5, vote_count: 20000, overview: 'Seven noble families…', poster_path: '/g.jpg',
  genres: [{ id: 10765, name: 'Sci-Fi & Fantasy' }], networks: [{ name: 'HBO' }],
  seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 3 }, { season_number: 2, episode_count: 2 }],
  last_episode_to_air: { season_number: 2, episode_number: 1 },
  next_episode_to_air: { season_number: 2, episode_number: 2, air_date: '2999-01-01' },
};
const SEASONS = {
  1: { episodes: [1, 2, 3].map((n) => ({ season_number: 1, episode_number: n, name: `S1 episode ${n}`, air_date: '2011-04-1' + n })) },
  2: { episodes: [{ season_number: 2, episode_number: 1, name: 'S2 opener', air_date: '2012-04-01' }, { season_number: 2, episode_number: 2, name: 'Future', air_date: '2999-01-01' }] },
};
function fakeTmdb() {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    seen.push(u.pathname);
    assert.equal(u.hostname, 'api.themoviedb.org');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    const path = u.pathname.replace('/3', '');
    if (path === '/movie/550') return Response.json(FIGHT_CLUB);
    if (path === '/tv/1399') return Response.json(SHOW);
    const season = path.match(/^\/tv\/1399\/season\/(\d+)$/);
    if (season) return Response.json(SEASONS[season[1]]);
    if (path === '/search/multi') return Response.json({ page: 1, total_pages: 1, total_results: 2, results: [{ ...FIGHT_CLUB, media_type: 'movie', genres: undefined, genre_ids: [18] }, { id: 9, media_type: 'person', name: 'Someone' }] });
    return new Response('{}', { status: 404 });
  };
  return seen;
}

test('the address picks the site, and cinemee gets its own database', () => {
  assert.equal(siteOf('https://cinemee.animee.space/movie'), 'cinemee');
  assert.equal(siteOf('http://cinemee.localhost:8787/'), 'cinemee');
  assert.equal(siteOf('https://animee.space/'), 'animee');
  const e = siteEnv({ DB: 'animee-db', CINEMEE_DB: 'cinemee-db' }, 'cinemee');
  assert.equal(e.DB, 'cinemee-db');
  assert.equal(siteEnv({ DB: 'animee-db', CINEMEE_DB: 'cinemee-db' }, 'animee').DB, 'animee-db');
  const shell = brandShell('<html lang="en"><a aria-label="animee, home"><span aria-hidden="true">anim<svg class="wm-eyes"></svg></span></a><p class="footer-tag">watch anime. stay happy.</p>', 'cinemee');
  assert.match(shell, /data-site="cinemee"/);
  assert.match(shell, />cinem<svg/);
  assert.match(shell, /not endorsed or certified by TMDB/);
});

test('movie and TV ids are single numbers that remember their type', () => {
  assert.equal(tmdb.encodeId('movie', 550), '5501');
  assert.equal(tmdb.encodeId('tv', 1399), '13992');
  assert.deepEqual(tmdb.decodeId('5501'), { type: 'movie', tmdb: '550' });
  assert.deepEqual(tmdb.decodeId('13992'), { type: 'tv', tmdb: '1399' });
  assert.throws(() => tmdb.decodeId('13993'), (e) => e.status === 404);
  assert.throws(() => tmdb.decodeId('abc'), (e) => e.status === 400);
});

test('a movie comes back in the same shape as an anime', async () => {
  tmdb.resetCache();
  fakeTmdb();
  const res = await onRequest(context('anime/5501'));
  assert.equal(res.status, 200);
  const a = await res.json();
  assert.equal(a.id, '5501');
  assert.equal(a.title, 'Fight Club');
  assert.equal(a.format, 'MOVIE');
  assert.equal(a.status, 'FINISHED');
  assert.equal(a.availableEpisodes, 1);
  assert.equal(a.duration, 139);
  assert.equal(a.score, 84);
  assert.equal(a.trailer, 'abc123');
  assert.equal(a.rating, 'R');
  assert.deepEqual(a.genres, ['Drama']);
  assert.equal(a.cover, 'https://image.tmdb.org/t/p/w500/p.jpg');
  const extras = await (await onRequest(context('anime/5501/extras'))).json();
  assert.equal(extras.characters[0].name, 'Edward Norton');
  assert.equal(extras.characters[0].role, 'Narrator');
  assert.equal(extras.recommendations[0].id, '6801');
});

test('a TV show counts only aired episodes and numbers them straight through', async () => {
  tmdb.resetCache();
  fakeTmdb();
  const show = await (await onRequest(context('anime/13992'))).json();
  assert.equal(show.status, 'RELEASING');
  assert.equal(show.availableEpisodes, 4, 'three in season 1 plus the first of season 2');
  assert.deepEqual(show.genres, ['Sci-Fi & Fantasy']);
  const { episodes } = await (await onRequest(context('anime/13992/episodes'))).json();
  assert.deepEqual(episodes.map((e) => [e.number, e.label]), [[1, 'S1 · E1'], [2, 'S1 · E2'], [3, 'S1 · E3'], [4, 'S2 · E1']]);
});

test('cinemee plays through Vega (vidsrc) then Nova (VidNest), by TMDB id and season/episode', async () => {
  tmdb.resetCache();
  fakeTmdb();
  const servers = await (await onRequest(context('episode/13992%3A4/servers'))).json();
  assert.deepEqual(servers.servers.map((s) => [s.id, s.name]), [['vidsrc', 'Vega'], ['vidnest', 'Nova']]);
  const tv = await (await onRequest(context('episode/13992%3A4/sources?server=auto&preferred=megaplay&category=sub'))).json();
  assert.equal(tv.embedUrl, 'https://vidsrc.to/embed/tv/1399/2/1');
  const vega = await (await onRequest(context('episode/5501%3A1/sources?server=vidsrc&category=sub'))).json();
  assert.equal(vega.embedUrl, 'https://vidsrc.to/embed/movie/550');
  const movie = await (await onRequest(context('episode/5501%3A1/sources?server=vidnest&category=sub'))).json();
  assert.equal(movie.embedUrl, 'https://vidnest.fun/movie/550');
  const missing = await onRequest(context('episode/13992%3A5/sources?server=vidnest&category=sub'));
  assert.equal(missing.status, 404, 'an episode that has not aired yet does not play');
});

test('search keeps movies and TV only, and genres come from the movie list', async () => {
  tmdb.resetCache();
  fakeTmdb();
  const found = await (await onRequest(context('search?q=fight'))).json();
  assert.deepEqual(found.results.map((r) => [r.id, r.genres[0]]), [['5501', 'Drama']]);
  const { genres } = await (await onRequest(context('genres'))).json();
  assert.ok(genres.includes('Science Fiction') && genres.includes('Western'));
  assert.ok(!genres.includes('Harem'));
});

test('without a token the catalogue says it is not set up, instead of crashing', async () => {
  tmdb.resetCache();
  const request = new Request('https://cinemee.animee.space/api/anime/5501');
  const res = await onRequest({ request, env: { SITE: 'cinemee' }, params: { path: ['anime', '5501'] } });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /not set up/);
});

test('movie and TV pages get their own titles, previews and one canonical address', async () => {
  const seo = await import('../functions/_lib/seo-cinemee.js');
  tmdb.resetCache();
  fakeTmdb();
  const page = await seo.describe(new URL('https://cinemee.animee.space/movie/5501/fight-club'), env);
  assert.equal(page.status, 200);
  assert.equal(page.title, 'Fight Club (1999): watch the movie · cinemee');
  assert.equal(page.canonical, 'https://cinemee.animee.space/movie/5501/fight-club');
  assert.equal(page.ld[0]['@type'], 'Movie');
  // Old anime-style address, wrong type and missing slug all settle on the canonical one.
  for (const path of ['/anime/5501', '/tv/5501/fight-club', '/movie/5501']) {
    const r = await seo.describe(new URL('https://cinemee.animee.space' + path), env);
    assert.equal(r.redirect, 'https://cinemee.animee.space/movie/5501/fight-club', path);
  }
  const show = await seo.describe(new URL('https://cinemee.animee.space/tv/13992/game-of-thrones'), env);
  assert.equal(show.ld[0]['@type'], 'TVSeries');
  assert.equal((await seo.describe(new URL('https://cinemee.animee.space/movie/13993'), env)).status, 404);
  assert.equal((await seo.describe(new URL('https://cinemee.animee.space/nonsense/page'), env)).status, 404);
  assert.match(seo.robots(), /Sitemap: https:\/\/cinemee\.animee\.space\/sitemap\.xml/);
});
