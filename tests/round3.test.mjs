import test from 'node:test';
import assert from 'node:assert/strict';
import { tvSeasons } from '../functions/_lib/providers/tmdb.js';
import { routeOf, cleanPlace } from '../functions/_lib/errors.js';
import { demotedList, clearDemotion } from '../functions/_lib/ranking.js';
import { siblingOrigin, handleContinue } from '../functions/_lib/crosssite.js';

test('TV seasons link to their first episode, numbered straight through; unstarted ones have no link', () => {
  const raw = { poster_path: '/p.jpg', seasons: [
    { season_number: 0, episode_count: 3, air_date: '2010-01-01' },
    { season_number: 2, episode_count: 8, air_date: '2012-04-01', name: 'Season 2' },
    { season_number: 1, episode_count: 10, air_date: '2011-04-17', name: 'Season 1' },
    { season_number: 3, episode_count: 6, air_date: '2999-01-01', name: 'Season 3' },
  ] };
  const s = tvSeasons('13992', raw);
  assert.deepEqual(s.map((x) => [x.season, x.startEp, x.episodes]), [[1, 1, 10], [2, 11, 8], [3, null, 6]]);
  assert.equal(s[0].cover, 'https://image.tmdb.org/t/p/w185/p.jpg');
});

test('errors are counted per route and short message, without ids or addresses', () => {
  assert.equal(routeOf('/api/anime/52991/episodes'), 'anime/:id/episodes');
  assert.equal(routeOf('/api/episode/52991%3A3/sources'), 'episode/:id/sources');
  assert.equal(cleanPlace('watch', 'TypeError: x is undefined at https://animee.space/js/app.js:1234\nmore'), 'watch: TypeError: x is undefined at <url>');
  assert.equal(cleanPlace('<script>', ''), 'script');
});

function reportsDb(rows) {
  const deleted = [];
  return {
    deleted,
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => ({ results: rows }),
        run: async () => { deleted.push([sql.includes('ep = ?') ? 'episode' : 'show', ...args]); },
      }),
    }),
  };
}

test('the admin list shows what is tried last, and a false alarm can be cleared', async () => {
  const day = Math.floor(Date.now() / 86400000);
  const rows = [
    { anime_id: 1, ep: 4, provider: 'megaplay', cat: 0, day, n: 2 },
    ...[1, 2, 3].map((ep) => ({ anime_id: 2, ep, provider: 'vidnest', cat: 1, day, n: 1 })),
    { anime_id: 3, ep: 1, provider: 'megaplay', cat: 0, day, n: 1 },
  ];
  const DB = reportsDb(rows);
  const list = await demotedList({ DB });
  assert.deepEqual(list.map((d) => [d.anime, d.ep, d.provider, d.category]).sort(), [['1', 4, 'megaplay', 'sub'], ['2', null, 'vidnest', 'dub']]);
  await clearDemotion({ DB }, { anime: '1', ep: 4, provider: 'megaplay', category: 'sub' });
  await clearDemotion({ DB }, { anime: '2', ep: null, provider: 'vidnest', category: 'dub' });
  assert.deepEqual(DB.deleted.map((d) => d[0]), ['episode', 'show']);
  await assert.rejects(clearDemotion({ DB }, { anime: 'x', provider: 'megaplay' }), (e) => e.status === 400);
});

test('each site only answers "continue" to its sibling, with credentials', async () => {
  assert.equal(siblingOrigin('https://animee.space/x'), 'https://cinemee.animee.space');
  assert.equal(siblingOrigin('https://cinemee.animee.space/x'), 'https://animee.space');
  assert.equal(siblingOrigin('http://cinemee.localhost:8787/'), 'http://localhost:8787');
  const ask = (origin) => handleContinue({ request: new Request('https://cinemee.animee.space/api/me/continue', { headers: origin ? { Origin: origin } : {} }), env: { SITE: 'cinemee' } });
  const stranger = await ask('https://evil.example');
  assert.equal(stranger.status, 403);
  assert.equal(stranger.headers.get('Access-Control-Allow-Origin'), null);
  const sibling = await ask('https://animee.space');
  assert.equal(sibling.status, 200);
  assert.equal(sibling.headers.get('Access-Control-Allow-Origin'), 'https://animee.space');
  assert.equal(sibling.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.deepEqual((await sibling.json()).items, []);
});
