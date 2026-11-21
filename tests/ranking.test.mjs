import test from 'node:test';
import assert from 'node:assert/strict';
import { demotedFrom, demotedServers, rankServers, resetRankingCache } from '../functions/_lib/ranking.js';
import { getServers, getFallbackSource, resetProviderHealth } from '../functions/_lib/providers/registry.js';

const today = 20000;

test('two failures on one episode demote that server for that episode only', () => {
  const rows = [{ ep: 5, provider: 'megaplay', cat: 0, n: 2, day: today }];
  assert.deepEqual([...demotedFrom(rows, 5, today)], ['megaplay:sub']);
  assert.equal(demotedFrom(rows, 6, today).size, 0);
  // One report is not enough, and old reports stop counting.
  assert.equal(demotedFrom([{ ep: 5, provider: 'megaplay', cat: 0, n: 1, day: today }], 5, today).size, 0);
  assert.equal(demotedFrom([{ ep: 5, provider: 'megaplay', cat: 0, n: 5, day: today - 4 }], 5, today).size, 0);
});

test('failures on three different episodes within two days demote a server for the whole show, per language', () => {
  const rows = [1, 2, 3].map((ep) => ({ ep, provider: 'vidnest', cat: 1, n: 1, day: today - 2 }));
  assert.deepEqual([...demotedFrom(rows, 9, today)], ['vidnest:dub']);
  const spread = [1, 2, 3].map((ep, i) => ({ ep, provider: 'vidnest', cat: 1, n: 1, day: today - 2 * i }));
  assert.equal(demotedFrom(spread, 9, today).size, 0, 'scattered over a week is not an outage');
});

test('ranking keeps the chosen order and moves struggling servers last', () => {
  const list = [{ id: 'a', category: 'sub' }, { id: 'b', category: 'sub' }, { id: 'c', category: 'sub' }];
  assert.deepEqual(rankServers(list, new Set(['a:sub'])).map((s) => s.id), ['b', 'c', 'a']);
  assert.equal(rankServers(list, new Set()), list);
});

function fakeDb(rows) {
  let calls = 0;
  return {
    calls: () => calls,
    prepare: () => ({ bind: () => ({ all: async () => { calls += 1; return { results: rows }; } }) }),
  };
}

test('the servers list flags struggling servers, and the fallback tries them last', async () => {
  resetRankingCache();
  resetProviderHealth();
  const day = Math.floor(Date.now() / 86400000);
  const DB = fakeDb([{ ep: 1, provider: 'vidnext', cat: 0, n: 3, day }]);
  const env = { SITE: 'cinemee', DB, TMDB_TOKEN: 't' };
  const servers = await getServers('5501', 1, env);
  assert.deepEqual(servers.map((s) => [s.id, Boolean(s.struggling)]).slice(0, 2), [['vidnext', true], ['vidnest', false]]);
  await getServers('5501', 1, env);
  assert.equal(DB.calls(), 1, 'the answer is remembered for a while');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/3/movie/550') return Response.json({ id: 550, title: 'Fight Club', release_date: '1999-10-15', status: 'Released', runtime: 139 });
    return new Response('{}', { status: 404 });
  };
  try {
    const src = await getFallbackSource('5501', 1, 'vidnext', 'sub', env);
    assert.equal(src.provider, 'vidnest', 'Orion keeps failing here, so Nova goes first');
  } finally { globalThis.fetch = originalFetch; }
});

test('no database or no reports table means nothing is demoted', async () => {
  resetRankingCache();
  assert.equal((await demotedServers({}, '1', 1)).size, 0);
  const broken = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('no such table: reports'); } }) }) };
  assert.equal((await demotedServers({ DB: broken }, '1', 1)).size, 0);
});
