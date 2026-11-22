// What mangee's pages look like to search engines and link previews (same shape as seo.js).
// Title pages live at /manga/<id>/<slug>; the reader (/watch/<id>) and personal pages are noindex.

import * as mangadex from './providers/mangadex.js';
import { SITES } from './site.js';

const SITE = 'mangee';
const ORIGIN = SITES.mangee.origin;
export const DEFAULT_DESC = 'Read manga online, keep your list and the exact page you stopped on, and get told about new chapters. Free, no ads, from MangaDex.';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'manga';
export const titlePath = (a) => `/manga/${a.id}/${slugify(a.title)}`;

const STATIC = {
  '': ['mangee: read manga online, no ads', DEFAULT_DESC],
  search: ['Browse manga', 'Find manga by genre, status, year and type: manga, manhwa and manhua.'],
  schedule: ['Latest updates', 'Manga with new chapters.'],
};
const LISTS = {
  airing: ['Latest updates', 'Manga with new chapters, newest first.'],
  season: ['New on mangee', 'Series recently added.'],
  completed: ['Completed manga', 'Finished series you can read start to end.'],
  popular: ['Most followed manga', 'The series most readers follow.'],
  favorite: ['Top rated manga', 'The best rated series.'],
  upcoming: ['Top rated, still ongoing', 'Highly rated series that are still coming out.'],
};
const PRIVATE = new Set(['watchlist', 'settings', 'account', 'random', 'new', 'stats', 'me', 'requests', 'admin', 'pick', 'az']);

export async function describe(url, env) {
  const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const [first, second, third] = parts;
  const image = ORIGIN + '/og.png';
  if (!first) return { status: 200, title: STATIC[''][0], description: DEFAULT_DESC, canonical: ORIGIN + '/', image, imageIsWide: true };
  if (STATIC[first] && !second) {
    const [title, description] = STATIC[first];
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: ORIGIN + '/' + first, image, imageIsWide: true, robots: first === 'search' && url.search ? 'noindex, follow' : null };
  }
  if (first === 'top' && LISTS[second] && !third) {
    const [title, description] = LISTS[second];
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: `${ORIGIN}/top/${second}`, image, imageIsWide: true };
  }
  if (PRIVATE.has(first) && !second) return { status: 200, title: SITE, description: DEFAULT_DESC, robots: 'noindex, follow', image, imageIsWide: true };
  if (first === 'u' && /^[a-z0-9_]{3,20}$/i.test(second || '') && !third) return { status: 200, title: `${second}'s list · ${SITE}`, description: DEFAULT_DESC, robots: 'noindex, follow', image, imageIsWide: true };

  const titlePage = ['manga', 'anime'].includes(first) && /^\d{1,12}$/.test(second || '') && parts.length <= 3;
  const readPage = first === 'watch' && /^\d{1,12}$/.test(second || '') && parts.length === 2;
  if (!titlePage && !readPage) return { status: 404 };

  mangadex.useEnv(env);
  let a;
  try { a = await mangadex.getAnime(second); }
  catch (error) {
    if (error?.status === 404 || error?.status === 400) return { status: 404 };
    return { status: 200, title: SITE, description: DEFAULT_DESC, transient: true };
  }
  const path = titlePath(a);
  if (titlePage) {
    if ('/' + parts.join('/') !== path) return { redirect: ORIGIN + path + url.search };
    const genres = (a.genres || []).slice(0, 3).join(', ');
    return {
      status: 200,
      title: `${a.title}: read the manga · ${SITE}`,
      description: clip(`Read ${a.title} online${genres ? `. ${genres}` : ''}. ${a.description || ''}`, 158),
      canonical: ORIGIN + path,
      image: a.cover ? ORIGIN + a.cover : image,
      imageIsWide: !a.cover,
      type: 'book',
      noscript: `<noscript><article><h1>${esc(a.title)}</h1><p>${esc(clip(a.description, 900))}</p><p><a href="/watch/${a.id}?ep=1">Read chapter 1</a></p></article></noscript>`,
    };
  }
  return { status: 200, title: `Read ${a.title} · ${SITE}`, description: clip(a.description, 158) || DEFAULT_DESC, canonical: ORIGIN + path, robots: 'noindex, follow', image: a.cover ? ORIGIN + a.cover : image };
}

export function robots() {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /watch/', 'Disallow: /watchlist', 'Disallow: /account', 'Disallow: /settings',
    `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n');
}

export async function sitemap() {
  const urls = ['/', '/search', ...Object.keys(LISTS).map((k) => `/top/${k}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}
