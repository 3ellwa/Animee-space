import test from 'node:test';
import assert from 'node:assert/strict';
import * as tmdb from '../functions/_lib/providers/tmdb.js';
import * as egybest from '../functions/_lib/providers/egybest.js';
import { getSources, getFallbackSource } from '../functions/_lib/providers/registry.js';

const env = { SITE: 'cinemee', TMDB_TOKEN: 'test-token' };
const SITE = egybest.DEFAULT_SITE;

// A fake TMDB (a film and a two-season show) and a fake EgyBest copy, shaped like the real pages.
const FILM = { id: 872585, title: 'Oppenheimer', original_title: 'Oppenheimer', release_date: '2023-07-19', status: 'Released' };
const SHOW = {
  id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20', status: 'Ended',
  seasons: [{ season_number: 1, episode_count: 2 }, { season_number: 2, episode_count: 2 }],
};
const SEASONS = { 1: [1, 2], 2: [1, 2] };
const OSMAN = { id: 90000, name: 'Establishment: Osman', original_name: 'Kuruluş: Osman', first_air_date: '2019-11-20', status: 'Ended', seasons: [{ season_number: 1, episode_count: 1 }] };
const ARABIC = { 872585: 'أوبنهايمر', 1396: 'بريكنج باد', 90000: 'المؤسس عثمان' };

const li = (vid, title) => `<li onClick="fill('${title}');" data-video-id="${vid}"><a href="${SITE}/watch.php?vid=${vid}"><img src="${SITE}/uploads/thumbs/${vid}-1.jpg" width="45" class="pm-sl-thumb" alt="${title}" />${title}</a></li>`;
const SEARCH = {
  Oppenheimer: li('f3f7e9d30', 'مشاهدة فيلم Oppenheimer 2023 مترجم ايجي بست') + li('aaaaa0001', 'مشاهدة فيلم Oppenheimer Explained 2024 مترجم'),
  'Breaking Bad': li('bb0000216', 'مسلسل Breaking Bad الموسم الثاني الحلقة 2 الثانية والأخيرة مترجم ايجي بست'),
  'Establishment: Osman': '',
  'Kuruluş: Osman': '',
  'المؤسس عثمان': li('os0000101', 'مسلسل المؤسس عثمان الحلقة 1 الاولي مترجم ايجي بست'),
};
const WATCH = {
  bb0000216: ['bb0000101', 'مسلسل Breaking Bad الموسم الاول الحلقة 1 الاولي مترجم'], // and the rest of the show
};
const PLAY = (vid, vip = true) => `<ul class="list_servers">${vip ? `<li class="active" id="server_Vipserver" data-embed="<iframe src='https://vipserver.liiivideo.com/embed-${vid}x.html' frameborder='0'></iframe>"><a><strong>Vipserver</strong></a></li>` : ''}<li id="server_Vidmoly" data-embed="<iframe src='https://vidmoly.net/embed-zzz.html'></iframe>"><a>Vidmoly</a></li></ul>`;

const MYCIMA = egybest.DEFAULT_SITES[1];
function fake({ challenge = false, walled = [], extra = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'api.themoviedb.org') {
      const path = u.pathname.replace('/3', '');
      const ar = u.searchParams.get('language') === 'ar-SA';
      const id = Number(path.split('/')[2]);
      const base = path.startsWith('/movie/') ? FILM : id === 90000 ? OSMAN : SHOW;
      if (/^\/(movie|tv)\/\d+$/.test(path)) return Response.json(ar ? { ...base, [base.title ? 'title' : 'name']: ARABIC[id] } : base);
      const season = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/);
      if (season) {
        const list = Number(season[1]) === 90000 ? [1] : SEASONS[season[2]];
        return Response.json({ episodes: list.map((n) => ({ season_number: Number(season[2]), episode_number: n, air_date: '2010-01-0' + n })) });
      }
      return new Response('{}', { status: 404 });
    }
    assert.ok(egybest.DEFAULT_SITES.includes(u.origin), u.origin);
    calls.push((u.origin === SITE ? '' : u.hostname) + u.pathname + u.search);
    if (challenge || walled.includes(u.origin)) return new Response('Just a moment...', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
    if (u.pathname === '/ajax-search.php') {
      assert.equal(init.method, 'POST');
      const q = new URLSearchParams(String(init.body)).get('queryString');
      if (u.origin !== SITE) return new Response(extra[u.origin]?.[q] ?? '');
      return new Response(SEARCH[q] ?? '');
    }
    const vid = u.searchParams.get('vid');
    if (u.pathname === '/watch.php') {
      const [other, title] = WATCH[vid] || [];
      return new Response(other ? `<a href="${SITE}/watch.php?vid=${other}" class="" title="${title}">` : '');
    }
    if (u.pathname === '/play.php') return new Response(PLAY(vid, vid !== 'nov1p0000'));
    return new Response('', { status: 404 });
  };
  return calls;
}
const reset = () => { tmdb.resetCache(); egybest.resetCache(); tmdb.useToken(env); };

test('listing titles: films with their year, episodes with Arabic season words', () => {
  assert.deepEqual(egybest.parseTitle('مشاهدة فيلم Dune: Part Two 2024 مترجم ايجي بست'), { kind: 'movie', name: 'dune part two', year: 2024 });
  assert.deepEqual(egybest.parseTitle('مسلسل Breaking Bad الموسم الخامس الحلقة 16 السادسة عشر والأخيرة'), { kind: 'episode', name: 'breaking bad', season: 5, episode: 16 });
  assert.deepEqual(egybest.parseTitle('مسلسل Last Samurai Standing الحلقة 6 السادسة والاخيرة'), { kind: 'episode', name: 'last samurai standing', season: 1, episode: 6 });
  assert.equal(egybest.seasonNumber('الأولى'), 1);
  assert.equal(egybest.seasonNumber('الحادي عشر'), 11);
  assert.equal(egybest.seasonNumber('الثاني عشر'), 12);
  assert.equal(egybest.seasonNumber('3'), 3);
  assert.equal(egybest.parseTitle('اعلان Oppenheimer'), null);
});

test('Altair finds a film by name and year and plays its Vipserver player', async () => {
  reset(); fake();
  const src = await getSources('8725851', 1, 'egybest', 'sub', env);
  assert.equal(src.embedUrl, 'https://vipserver.liiivideo.com/embed-f3f7e9d30x.html');
  assert.equal(src.embedOrigin, 'https://vipserver.liiivideo.com');
  assert.equal(src.provider, 'egybest');
});

test('Altair finds an episode from the show list on another episode\'s page', async () => {
  reset(); const calls = fake();
  const src = await getSources('13962', 1, 'egybest', 'sub', env); // S1 E1
  assert.equal(src.embedUrl, 'https://vipserver.liiivideo.com/embed-bb0000101x.html');
  assert.ok(calls.includes('/watch.php?vid=bb0000216'));
  const again = await getSources('13962', 1, 'egybest', 'sub', env);
  assert.equal(again.embedUrl, src.embedUrl);
  assert.equal(calls.filter((c) => c.startsWith('/play.php')).length, 1, 'found players are remembered');
  const direct = await getSources('13962', 4, 'egybest', 'sub', env); // S2 E2, straight from the search
  assert.equal(direct.embedUrl, 'https://vipserver.liiivideo.com/embed-bb0000216x.html');
});

test('Turkish shows are found by their Arabic name', async () => {
  reset(); fake();
  const src = await getSources('900002', 1, 'egybest', 'sub', env);
  assert.equal(src.embedUrl, 'https://vipserver.liiivideo.com/embed-os0000101x.html');
});

test('a title the site lacks is a 404, so automatic playback moves on to the next server', async () => {
  reset(); fake();
  await assert.rejects(getSources('13962', 2, 'egybest', 'sub', env), { status: 404 }); // S1 E2 isn't listed
  const auto = await getFallbackSource('13962', 2, 'egybest', 'sub', env);
  assert.equal(auto.provider, 'vidnext', 'chosen Altair lacks it: back to the list order');
  assert.equal(auto.fallback, true);
});

test('a title the first site lacks is looked up on the next one', async () => {
  reset();
  const calls = fake({ extra: { [MYCIMA]: { 'Breaking Bad': li('mc0000102', 'مسلسل Breaking Bad الموسم الاول الحلقة 2 الثانية مترجم ماي سيما') } } });
  const src = await getSources('13962', 2, 'egybest', 'sub', env); // S1 E2: not on the EgyBest copy
  assert.equal(src.embedUrl, 'https://vipserver.liiivideo.com/embed-mc0000102x.html');
  assert.ok(calls.includes('cima.my-cima.net/play.php?vid=mc0000102'));
});

test('a site behind a Cloudflare challenge is skipped (for a while), the next one still answers', async () => {
  reset();
  const calls = fake({ walled: [SITE], extra: { [MYCIMA]: { Oppenheimer: li('mc0000001', 'مشاهدة فيلم Oppenheimer 2023 مترجم ماي سيما') } } });
  const src = await getSources('8725851', 1, 'egybest', 'sub', env);
  assert.equal(src.embedUrl, 'https://vipserver.liiivideo.com/embed-mc0000001x.html');
  const walledAsked = () => calls.filter((c) => c.startsWith('/')).length; // the EgyBest copy's calls have no host prefix
  assert.equal(walledAsked(), 1);
  await assert.rejects(getSources('13962', 2, 'egybest', 'sub', env), { status: 404 }); // another title, same minute
  assert.equal(walledAsked(), 1, 'the walled site is skipped instead of asked again');
});

test('when every site shows a challenge it\'s an outage, not "not found"', async () => {
  reset(); fake({ challenge: true });
  await assert.rejects(egybest.getSources('8725851', 1, env), { status: 502 });
});

test('the site list can be replaced with EGYBEST_URL, but only with plain https addresses', () => {
  assert.deepEqual(egybest.siteUrls({ EGYBEST_URL: 'https://egy.example.com/, https://b.example.com' }), ['https://egy.example.com', 'https://b.example.com']);
  assert.deepEqual(egybest.siteUrls({ EGYBEST_URL: 'http://egy.example.com' }), egybest.DEFAULT_SITES);
  assert.deepEqual(egybest.siteUrls({ EGYBEST_URL: 'https://user:pw@egy.example.com' }), egybest.DEFAULT_SITES);
  assert.deepEqual(egybest.siteUrls({}), egybest.DEFAULT_SITES);
});
