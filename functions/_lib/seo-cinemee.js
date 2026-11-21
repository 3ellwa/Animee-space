// Search-engine and link-preview details for cinemee (movies and TV), the counterpart of the
// animee part of seo.js. Pages: /movie/<id>/<slug>, /tv/<id>/<slug> and /watch/<id>?ep=N.
import * as tmdb from './providers/tmdb.js';
import { SITES } from './site.js';

const ORIGIN = SITES.cinemee.origin;
const SITE = 'cinemee';
export const DEFAULT_DESC = 'Watch movies and TV shows, keep your list and your place in every episode, and see what airs this week. Free, with no account needed.';

const clip = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : clean;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const kind = (id) => (/1$/.test(String(id)) ? 'movie' : 'tv');
export const titlePath = (a) => `/${kind(a.id)}/${a.id}${a.title ? '/' + slugify(a.title) : ''}`;

const STATIC = {
  '': ['cinemee: watch movies and TV', DEFAULT_DESC, 'daily', '1.0'],
  search: ['Browse movies and TV by genre, year and score', 'Find movies and TV shows by genre, year, score and type.', 'weekly', '0.8'],
  schedule: ['TV schedule this week', 'Which TV shows have a new episode out each day this week.', 'daily', '0.7'],
  pick: ['Help me pick a movie or show', 'Answer a few questions and get something to watch tonight.', 'monthly', '0.5'],
};
const LISTS = {
  airing: ['TV shows on this week', 'TV shows with new episodes out this week.'],
  popular: ['Trending movies and TV', 'What everyone is watching this week.'],
  favorite: ['Top rated movies and TV', 'The highest rated movies and TV shows.'],
  upcoming: ['Movies coming to cinemas', 'New movies coming soon, with release dates and trailers.'],
  season: ['Movies in cinemas now', 'The movies playing in cinemas right now.'],
  completed: ['Complete TV series', 'TV series that have finished, ready to binge.'],
};
const PRIVATE = new Set(['watchlist', 'settings', 'account', 'random', 'new', 'stats', 'me', 'requests', 'admin', 'az']);
const SHORTCUTS = new Set(['tv', 'movies', 'airing', 'upcoming']);

function ld(a, path) {
  const movie = a.format === 'MOVIE';
  const date = (d) => (d?.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : undefined);
  return {
    '@context': 'https://schema.org',
    '@type': movie ? 'Movie' : 'TVSeries',
    name: a.title,
    url: ORIGIN + path,
    image: a.cover || undefined,
    description: clip(a.description, 500) || undefined,
    genre: a.genres?.length ? a.genres : undefined,
    ...(movie ? { datePublished: date(a.startDate), duration: a.duration ? `PT${a.duration}M` : undefined }
      : { startDate: date(a.startDate), numberOfSeasons: a.seasonCount || undefined, numberOfEpisodes: a.availableEpisodes || undefined }),
  };
}
const crumbs = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [['Home', ORIGIN + '/'], ...items].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});
const noscript = (a, path) => `<noscript><article><h1>${esc(a.title)}</h1>
<p>${esc(clip(a.description, 900))}</p>
<p>${esc([a.format === 'MOVIE' ? 'Movie' : 'TV series', a.year, ...(a.genres || [])].filter(Boolean).join(' · '))}</p>
<p><a href="/watch/${a.id}?ep=1">${a.format === 'MOVIE' ? 'Watch the movie' : 'Watch episode 1'}</a> · <a href="${esc(path)}">${esc(a.title)}</a></p></article></noscript>`;

const WEBSITE_LD = {
  '@context': 'https://schema.org', '@type': 'WebSite', name: SITE, url: ORIGIN + '/',
  potentialAction: { '@type': 'SearchAction', target: ORIGIN + '/search?q={search_term_string}', 'query-input': 'required name=search_term_string' },
};

/** What one cinemee address should look like in search results (same shape as seo.describe). */
export async function describe(url, env) {
  const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const [first, second, third] = parts;
  const image = ORIGIN + '/og.png';
  if (!first) return { status: 200, title: STATIC[''][0], description: DEFAULT_DESC, canonical: ORIGIN + '/', image, imageIsWide: true, ld: [WEBSITE_LD] };
  if (STATIC[first] && !second) {
    const [title, description] = STATIC[first];
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: ORIGIN + '/' + first, image, imageIsWide: true, robots: first === 'search' && url.search ? 'noindex, follow' : null };
  }
  if (first === 'top' && LISTS[second] && !third) {
    const [title, description] = LISTS[second];
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: `${ORIGIN}/top/${second}`, image, imageIsWide: true };
  }
  if ((PRIVATE.has(first) || SHORTCUTS.has(first)) && !second) return { status: 200, title: SITE, description: DEFAULT_DESC, robots: 'noindex, follow', image, imageIsWide: true };

  const titlePage = ['movie', 'tv', 'anime'].includes(first) && /^\d{2,12}$/.test(second || '') && parts.length <= 3;
  const watchPage = first === 'watch' && /^\d{2,12}$/.test(second || '') && parts.length === 2;
  if (!titlePage && !watchPage) return { status: 404 };

  tmdb.useToken(env);
  let a;
  try { a = await tmdb.getAnime(second); }
  catch (error) {
    if (error?.status === 404 || error?.status === 400) return { status: 404 };
    return { status: 200, title: SITE, description: DEFAULT_DESC, transient: true }; // catalogue hiccup: serve the app, cache nothing
  }
  const path = titlePath(a);
  const name = a.title || 'Untitled';
  const year = a.year ? ` (${a.year})` : '';
  const movie = a.format === 'MOVIE';
  const genres = (a.genres || []).slice(0, 3).join(', ');
  if (titlePage) {
    // One address per title: /anime/…, the wrong type or an old slug redirect to /movie|tv/<id>/<slug>.
    if ('/' + parts.join('/') !== path) return { redirect: ORIGIN + path + url.search };
    return {
      status: 200,
      title: `${name}${year}: watch ${movie ? 'the movie' : 'every episode'} · ${SITE}`,
      description: clip(`Watch ${name}${year} online${genres ? `. ${genres}` : ''}. ${a.description || ''}`, 158),
      canonical: ORIGIN + path,
      image: a.banner || a.cover,
      imageIsWide: Boolean(a.banner),
      type: movie ? 'video.movie' : 'video.tv_show',
      ld: [ld(a, path), crumbs([[name, ORIGIN + path]])],
      noscript: noscript(a, path),
    };
  }
  const ep = Math.max(1, Math.min(2000, Number(url.searchParams.get('ep')) || 1));
  return {
    status: 200,
    title: movie ? `Watch ${name}${year} · ${SITE}` : `Watch ${name} episode ${ep} · ${SITE}`,
    description: clip(`Watch ${name}${movie ? '' : ` episode ${ep}`} online. ${a.description || ''}`, 158),
    canonical: movie ? `${ORIGIN}/watch/${a.id}` : `${ORIGIN}/watch/${a.id}?ep=${ep}`,
    image: a.banner || a.cover,
    imageIsWide: Boolean(a.banner),
    type: movie ? 'video.movie' : 'video.episode',
    ld: [crumbs([[name, ORIGIN + path], [movie ? 'Watch' : `Episode ${ep}`, `${ORIGIN}/watch/${a.id}${movie ? '' : `?ep=${ep}`}`]])],
  };
}

export function robots() {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/',
    ...[...PRIVATE].map((p) => `Disallow: /${p}`),
    '', `Sitemap: ${ORIGIN}/sitemap.xml`, ''].join('\n');
}

/** Fixed pages, the ranked lists, and the titles currently on them. */
export async function sitemap(env) {
  tmdb.useToken(env);
  const today = new Date().toISOString().slice(0, 10);
  const urls = Object.entries(STATIC).map(([path, [, , freq, priority]]) => ({ loc: ORIGIN + '/' + path, freq, priority }));
  for (const name of Object.keys(LISTS)) urls.push({ loc: `${ORIGIN}/top/${name}`, freq: 'daily', priority: '0.7' });
  const seen = new Set();
  for (const name of Object.keys(LISTS)) {
    const { results = [] } = await tmdb.getList(name, 25).catch(() => ({}));
    for (const a of results) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      urls.push({ loc: ORIGIN + titlePath(a), freq: a.status === 'RELEASING' ? 'daily' : 'weekly', priority: '0.6' });
    }
  }
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
