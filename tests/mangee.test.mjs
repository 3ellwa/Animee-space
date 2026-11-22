import test from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, siteEnv, brandShell } from '../functions/_lib/site.js';
import { sessionCookie, clearCookie } from '../functions/_lib/auth.js';
import { parseImageUrl } from '../functions/_lib/mdimg.js';
import { sisterOrigins } from '../functions/_lib/crosssite.js';
import * as md from '../functions/_lib/providers/mangadex.js';

test('mangee is its own site with its own lists, and every site shares one set of accounts', () => {
  assert.equal(siteOf('https://mangee.animee.space/'), 'mangee');
  assert.equal(siteOf('http://mangee.localhost:8787/x'), 'mangee');
  const env = { DB: 'animee-db', CINEMEE_DB: 'cinemee-db', MANGEE_DB: 'mangee-db' };
  assert.deepEqual([siteEnv(env, 'mangee').DB, siteEnv(env, 'mangee').USERS_DB], ['mangee-db', 'animee-db']);
  assert.deepEqual([siteEnv(env, 'cinemee').DB, siteEnv(env, 'cinemee').USERS_DB], ['cinemee-db', 'animee-db']);
  assert.equal(siteEnv(env, 'animee').USERS_DB, 'animee-db');
  const shell = brandShell('<html lang="en"><title>animee space</title><a aria-label="animee, home"><span aria-hidden="true">anim<svg class="wm-eyes"></svg></span></a><input placeholder="Search anime"><p class="footer-tag">watch anime. stay happy.</p>', 'mangee');
  assert.match(shell, /data-site="mangee"/);
  assert.match(shell, />mang<svg/);
  assert.match(shell, /Search manga/);
  assert.match(shell, /Manga from <a href="https:\/\/mangadex.org\/"/);
});

test('one login works on every sister site: the cookie is set for animee.space on the live sites', async () => {
  const env = { SESSION_SECRET: 'x'.repeat(40) };
  const live = await sessionCookie(env, { id: 1, ver: 1 }, 'https://mangee.animee.space/api/auth/login');
  assert.match(live, /^am_session=/);
  assert.match(live, /; Domain=animee\.space;/);
  const local = await sessionCookie(env, { id: 1, ver: 1 }, 'http://localhost:8787/api/auth/login');
  assert.doesNotMatch(local, /Domain=/);
  assert.match(clearCookie('https://cinemee.animee.space/x'), /Max-Age=0/);
  assert.match(clearCookie('https://cinemee.animee.space/x'), /Domain=animee\.space/);
});

test('"Continue on…" answers every sister site, never a stranger', () => {
  assert.deepEqual(sisterOrigins('https://animee.space/api/me/continue'), ['https://cinemee.animee.space', 'https://mangee.animee.space']);
  assert.deepEqual(sisterOrigins('https://mangee.animee.space/api/me/continue'), ['https://animee.space', 'https://cinemee.animee.space']);
});

test('the image proxy only fetches MangaDex images, and caches pages by their content hash', () => {
  const cover = parseImageUrl('https://uploads.mangadex.org/covers/a77742b1-befd-49a4-bff5-1ad4e6b0ef7b/6e518bd1-5f60-446b-8832-bfe6bf74834b.jpg.512.jpg');
  assert.ok(cover && !cover.report);
  const page = parseImageUrl('https://abc123.mangadex.network/data-saver/9ca783495183d5aa0000000000000000/1-abc.jpg');
  assert.equal(page.cacheKey, 'https://mdimg.cache/data-saver/9ca783495183d5aa0000000000000000/1-abc.jpg');
  assert.equal(page.report, true, 'MangaDex@Home pages are reported back');
  assert.equal(parseImageUrl('https://evil.example/data/9ca783495183d5aa0000000000000000/1.jpg'), null);
  assert.equal(parseImageUrl('http://uploads.mangadex.org/covers/x/y.jpg'), null);
  assert.equal(parseImageUrl('https://uploads.mangadex.org/data/../../etc/passwd'), null);
});

// A tiny fake mangee database for the UUID -> number table.
function fakeDb() {
  const rows = [];
  return {
    prepare(sql) {
      const st = { args: [], bind(...a) { st.args = a; return st; } };
      st.run = async () => { if (/^INSERT OR IGNORE/.test(sql) && !rows.some((r) => r.uuid === st.args[0])) rows.push({ id: rows.length + 1, uuid: st.args[0] }); };
      st.all = async () => ({ results: rows.filter((r) => st.args.includes(r.uuid)) });
      st.first = async () => rows.find((r) => r.id === st.args[0]) || null;
      return st;
    },
    async batch(list) { for (const s of list) await s.run(); },
  };
}
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;

test('chapters: one per chapter number, preferred language first, publisher links left out, numbered straight through', async () => {
  md.resetCache();
  md.useEnv({ DB: fakeDb() });
  const id = (await md.idsFor([U(1)])).get(U(1));
  assert.equal(await md.uuidOf(id), U(1));
  const original = globalThis.fetch;
  const ch = (cid, chapter, lang, pages, extra = {}) => ({ id: cid, attributes: { chapter, translatedLanguage: lang, pages, title: null, volume: '1', publishAt: '2024-01-01T00:00:00Z', ...extra }, relationships: [{ type: 'scanlation_group', attributes: { name: `G-${lang}` } }] });
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    assert.equal(u.hostname, 'api.mangadex.org');
    if (u.pathname.endsWith('/feed')) {
      return Response.json({ data: [
        ch('c1en', '1', 'en', 20), ch('c1ar', '1', 'ar', 18), ch('c2en', '2', 'en', 22), ch('c2en-b', '2', 'en', 25),
        ch('c3off', '3', 'en', 0, { externalUrl: 'https://mangaplus.example/3' }), ch('c10en', '10', 'en', 19),
      ] });
    }
    throw new Error('unexpected ' + u);
  };
  try {
    const en = await md.getEpisodes(id, 'en');
    assert.deepEqual(en.episodes.map((e) => [e.number, e.label, e.chapterId]), [[1, 'Ch. 1', 'c1en'], [2, 'Ch. 2', 'c2en-b'], [3, 'Ch. 10', 'c10en']]);
    assert.equal(en.officialOnly, 1, 'a chapter that only links to the publisher is counted, not listed');
    const arFirst = await md.getEpisodes(id, 'ar,en');
    assert.equal(arFirst.episodes[0].chapterId, 'c1ar', 'Arabic first when asked');
    assert.deepEqual(arFirst.episodes[0].groups, ['G-ar']);
  } finally { globalThis.fetch = original; }
});

test('a MangaDex series becomes an animee-shaped title (cover through our proxy, family-friendly only)', () => {
  const m = { id: U(2), attributes: { title: { 'ja-ro': 'Chainsaw Man' }, altTitles: [{ en: 'Chainsaw Man' }, { ja: 'チェンソーマン' }], description: { en: 'Denji…' }, status: 'completed', year: 2018, contentRating: 'safe', originalLanguage: 'ja', lastChapter: '97', tags: [{ attributes: { name: { en: 'Action' }, group: 'genre' } }], links: { engtl: 'https://www.viz.com/csm' } },
    relationships: [{ type: 'cover_art', attributes: { fileName: 'c.jpg' } }, { type: 'author', attributes: { name: 'Fujimoto Tatsuki' } }] };
  const t = md.normalize(m, '7', { rating: { bayesian: 9.21 }, follows: 1000 });
  assert.equal(t.title, 'Chainsaw Man');
  assert.equal(t.status, 'FINISHED');
  assert.equal(t.score, 92);
  assert.equal(t.officialUrl, 'https://www.viz.com/csm');
  assert.deepEqual(t.studios, ['Fujimoto Tatsuki']);
  assert.match(t.cover, /^\/api\/mdimg\?u=https%3A%2F%2Fuploads\.mangadex\.org%2Fcovers%2F/);
  assert.equal(md.normalize({ ...m, attributes: { ...m.attributes, contentRating: 'erotica' } }, '8'), null);
});
