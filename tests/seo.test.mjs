import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import worker from '../worker.js';
import { throttle } from '../functions/_lib/providers/tenrai.js';

throttle.gapMs = 0;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ctx = { waitUntil() {} };
const get = (path) => worker.fetch(new Request('https://animee.space' + path), {}, ctx);

const row = (id, title, extra = {}) => ({
  mal_id: id, title, title_english: title, title_japanese: 'テスト', type: 'TV', episodes: 12, status: 'Finished Airing',
  synopsis: `${title} is a story about friends.\n\n[Written by MAL Rewrite]`, score: 8.1, members: 1000, year: 2023,
  aired: { from: '2023-04-01T00:00:00+00:00', to: '2023-06-20T00:00:00+00:00' },
  images: { jpg: { large_image_url: `https://cdn.example/${id}.jpg` } },
  genres: [{ name: 'Adventure' }], themes: [], demographics: [], studios: [{ name: 'Studio Sample' }], rating: 'PG-13 - Teens 13 or older',
  ...extra,
});
function catalogue(rows) {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const m = u.pathname.match(/\/anime\/(\d+)\/full$/);
    if (m) {
      const found = rows.find((r) => String(r.mal_id) === m[1]);
      return found ? Response.json({ data: found }) : Response.json({ message: 'Not found' }, { status: 404 });
    }
    return Response.json({ data: rows, pagination: { has_next_page: false } });
  };
}

test('anime pages get their own title, description, canonical, previews and JSON-LD', async () => {
  catalogue([row(8101, 'Sample Quest')]);
  const res = await get('/anime/8101/sample-quest');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<title>Sample Quest \(2023\): watch every episode · animee<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/animee.space\/anime\/8101\/sample-quest">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/cdn.example\/8101.jpg">/);
  assert.match(html, /"@type":"TVSeries"/);
  assert.match(html, /<meta name="robots" content="index, follow/);
  assert.ok(!/Written by MAL Rewrite/.test(html.split('</head>')[0]), 'credit lines are trimmed from descriptions');
  assert.match(html, /<noscript><article><h1>Sample Quest<\/h1>/);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1);
});

test('an anime address without the right slug redirects to the canonical one', async () => {
  catalogue([row(8102, 'Slug Test')]);
  const res = await get('/anime/8102');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://animee.space/anime/8102/slug-test');
});

test('unknown pages and missing shows return a real 404', async () => {
  catalogue([]);
  const missing = await get('/anime/999999/nothing');
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /noindex/);
  assert.equal((await get('/definitely/not/a/page')).status, 404);
  assert.equal((await get('/missing-file.png')).status, 404);
});

test('personal pages are kept out of search results', async () => {
  const res = await get('/watchlist');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<meta name="robots" content="noindex, follow">/);
});

test('robots.txt allows crawling and points to the sitemap; the API is noindex', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/animee.space\/sitemap.xml/);
  catalogue([row(8103, 'Api Sample')]);
  const api = await get('/api/anime/8103');
  assert.equal(api.headers.get('x-robots-tag'), 'noindex');
});

test('the sitemap lists pages and shows, and leaves out shows hidden from browsing', async () => {
  catalogue([row(8104, 'Listed Show'), row(8105, 'Harem Show', { themes: [{ name: 'Harem' }] })]);
  const res = await get('/sitemap.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.match(xml, /<loc>https:\/\/animee.space\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/animee.space\/top\/popular<\/loc>/);
  assert.match(xml, /<loc>https:\/\/animee.space\/anime\/8104\/listed-show<\/loc>/);
  assert.ok(!xml.includes('harem-show'));
});

test('the home page carries WebSite search markup and the share image', async () => {
  const html = await (await get('/')).text();
  assert.match(html, /"@type":"WebSite"/);
  assert.match(html, /search\?q=\{search_term_string\}/);
  assert.match(html, /<meta property="og:image" content="https:\/\/animee.space\/og.png">/);
});
