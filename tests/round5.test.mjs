import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanStatus } from '../functions/_lib/account.js';
import { visibleRow, publicList, shareMode, shareBits } from '../functions/_lib/share.js';
import { handlePlay, popularHere } from '../functions/_lib/popular.js';
import { cleanChat } from '../functions/_lib/party.js';
import { cleanVtt, srtToVtt } from '../functions/_lib/subs.js';
import worker from '../worker.js';

test('your rating rides in the status number, 1-10, and survives the server clean-up', () => {
  const s = 3 | 8 | (9 << 7); // completed, favourite, rated 9
  assert.equal(cleanStatus(s), s);
  assert.equal((cleanStatus(s) >> 7) & 15, 9);
  assert.equal((cleanStatus(3 | (14 << 7)) >> 7) & 15, 0, 'ratings above 10 are dropped');
  assert.equal(cleanStatus(5000), cleanStatus(2047));
});

test('shared lists: off by default, whole list or favourites, never "not interested"', async () => {
  assert.equal(shareMode(1 | 2), 'off');
  assert.equal(shareMode(shareBits('all') | 3), 'all');
  assert.equal(shareMode(shareBits('favourites')), 'favourites');
  assert.equal(visibleRow(6, 'all'), false);
  assert.equal(visibleRow(6 | 8, 'all'), true);
  assert.equal(visibleRow(1, 'favourites'), false);
  assert.equal(visibleRow(7 << 7, 'all'), true, 'rated but not on a list');
  assert.equal(visibleRow(6 | (7 << 7), 'all'), false, 'not interested stays hidden even if rated');
  const db = (user, rows) => ({ prepare: (sql) => ({ bind: () => ({ first: async () => user, all: async () => ({ results: rows }) }) }) });
  const cat = { getAnime: async (id) => ({ id, title: `Show ${id}` }) };
  await assert.rejects(publicList({ DB: db({ id: 1, name: 'ali', prefs: 3 }, []) }, 'ali', cat), (e) => e.status === 404);
  await assert.rejects(publicList({ DB: db(null, []) }, 'nobody', cat), (e) => e.status === 404);
  const out = await publicList({ DB: db({ id: 1, name: 'ali', prefs: 16 }, [{ anime_id: 5, s: 3 | (8 << 7), u: 2 }, { anime_id: 6, s: 6, u: 1 }]) }, 'ALI', cat);
  assert.deepEqual(out.items.map((i) => [i.id, i.status, i.rating]), [['5', 'completed', 8]]);
});

test('plays are counted per show and day, and only shows played more than once are listed', async () => {
  const calls = [];
  const DB = { prepare: (sql) => ({ bind: (...args) => ({ run: async () => calls.push([sql.slice(0, 20), ...args]), all: async () => ({ results: [{ anime_id: 7, n: 4 }] }) }) }) };
  const post = (body) => new Request('https://animee.space/api/play', { method: 'POST', body: JSON.stringify(body), headers: { Origin: 'https://animee.space' } });
  assert.equal((await handlePlay(post({ a: '52991' }), { DB })).status, 200);
  assert.equal(calls[0][2], 52991);
  assert.equal((await handlePlay(post({ a: 'x' }), { DB })).status, 400);
  const { results } = await popularHere({ DB }, { getAnime: async (id) => ({ id, title: 'T' }) });
  assert.deepEqual(results.map((r) => [r.id, r.plays]), [['7', 4]]);
});

test('party chat lines are plain, short and named', () => {
  assert.deepEqual(cleanChat({ text: '  hi\u0000 there  ', name: 'ali<script>' }), { name: 'aliscript', text: 'hi there' });
  assert.equal(cleanChat({ text: '   ' }), null);
  assert.equal(cleanChat({ text: 'x'.repeat(500) }).text.length, 200);
  assert.equal(cleanChat({ text: 'yo' }).name, 'Guest');
});

test('subtitle files: SRT becomes WebVTT, only real subtitle text is accepted', () => {
  const vtt = srtToVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\nمرحبا\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n<i>Hi</i>\r\n');
  assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.500\nمرحبا/);
  assert.ok(cleanVtt(vtt));
  assert.equal(cleanVtt('hello'), null);
  assert.match(cleanVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<script>x</script><i>ok</i>\n'), /^WEBVTT[\s\S]*x<i>ok<\/i>/);
});

test('scripts and styles answer "not modified" when the browser already has them', async () => {
  const first = await worker.fetch(new Request('https://animee.space/js/site.js'), {}, { waitUntil() {} });
  const etag = first.headers.get('ETag');
  assert.ok(etag);
  const again = await worker.fetch(new Request('https://animee.space/js/site.js', { headers: { 'If-None-Match': etag } }), {}, { waitUntil() {} });
  assert.equal(again.status, 304);
});

test('review fixes: shared total counts every visible title; uploads may be raw .srt text', async () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ anime_id: i + 1, s: 1, u: 70 - i }));
  const DB = { prepare: () => ({ bind: () => ({ first: async () => ({ id: 1, name: 'ali', prefs: 16 }), all: async () => ({ results: rows }) }) }) };
  const out = await publicList({ DB }, 'ali', { getAnime: async (id) => ({ id, title: 't' }) });
  assert.equal(out.total, 70);
  assert.equal(out.items.length, 60);
  const { handleSubs } = await import('../functions/_lib/subs.js');
  const saved = [];
  const subsDb = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => saved.push(a) }) }) };
  const req = new Request('https://cinemee.animee.space/api/subs', { method: 'POST', headers: { Origin: 'https://cinemee.animee.space' }, body: JSON.stringify({ text: '1\n00:00:01,000 --> 00:00:02,000\nHi\n' }) });
  const res = await handleSubs({ request: req, env: { DB: subsDb } }, ['subs']);
  assert.equal(res.status, 200);
  assert.match(saved[0][1], /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.000/);
});

test('Rem (animeembed.com) and Ram (aniembed.se) are animee servers with sub and dub', async () => {
  const { getProviderList, getSources } = await import('../functions/_lib/providers/registry.js');
  const list = getProviderList({}).map((p) => [p.id, p.name]);
  assert.deepEqual(list.slice(0, 2), [['megaplay', '3ellwa'], ['animeembed', 'Rem']]);
  assert.deepEqual(list.at(-1), ['aniembed', 'Ram']);
  const rem = await getSources('52991', 3, 'animeembed', 'dub', {});
  assert.equal(rem.embedUrl, 'https://animeembed.com/embed/mal/52991/3?track=dub&autoPlay=1&autoNext=0&autoSkip=1&accent=C6FF3D');
  const ram = await getSources('52991', 3, 'aniembed', 'sub', {}, { aniListId: '154587' });
  assert.equal(ram.embedUrl, 'https://aniembed.se/e/154587/3?lang=sub&autoplay=1');
});

test('Rem and Ram are skipped when they do not have the episode, and a dead one counts as an outage', async () => {
  const ae = await import('../functions/_lib/providers/animeembed.js');
  const an = await import('../functions/_lib/providers/aniembed.js');
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.hostname === 'animeembed.com') return new Response('x', { status: u.pathname.includes('/99999999/') ? 404 : 200 });
      if (u.hostname === 'aniembed.se') return new Response(u.pathname.endsWith('/999') ? "<p>Couldn't load the player</p><p>API responded with 404</p>" : '<div class="player"></div>');
      throw new Error('unexpected ' + u);
    };
    assert.equal(await ae.isAvailable('99999999', 1, 'sub'), false);
    assert.equal(await ae.isAvailable('52991', 1, 'sub'), true);
    assert.equal(await an.isAvailable('52991', 999, 'sub', '154587'), false);
    assert.equal(await an.isAvailable('52991', 1, 'sub', '154587'), true);
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(ae.isAvailable('52991', 2, 'sub'), (e) => e.status === 502);
  } finally { globalThis.fetch = original; }
});
