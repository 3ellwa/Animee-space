// Search engine and link-preview support. The site is a single-page app, so the Worker fills in
// each page's <head> (title, description, canonical, Open Graph, JSON-LD) before sending
// index.html, and answers /sitemap.xml and /robots.txt. Crawlers and chat apps that don't run
// JavaScript still see the right title, description and image for every show.
import * as tenrai from './providers/tenrai.js';
import { SITES } from './site.js';

export const ORIGIN = 'https://animee.space';
const SITE = 'animee';
const OG_IMAGE = ORIGIN + '/og.png';
const DEFAULT_DESC = 'Watch anime in sub and dub, keep your list and your place in every show, and see what airs this week. Free, with no account needed.';
const CINEMEE_DESC = 'Watch movies and TV shows, keep your list and your place in every episode, and see what airs this week. Free, with no account needed.';
const CINEMEE_ORIGIN = SITES.cinemee.origin;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON inside <script type="application/ld+json"> must not be able to close the tag.
const ldJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');
const clip = (text, max) => {
  const clean = String(text || '').replace(/\s+/g, ' ').replace(/\[Written by [^\]]*\]/gi, '').trim();
  return clean.length > max ? clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : clean;
};

export const slugify = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
export const animePath = (a) => `/anime/${a.id}${a.title ? '/' + slugify(a.title) : ''}`;

const FORMAT = { TV: 'TV series', TV_SHORT: 'TV short', TV_SPECIAL: 'TV special', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music video' };
const LISTS = {
  airing: ['Top airing anime', 'The best anime airing right now, ranked by score.'],
  popular: ['Most popular anime', 'The anime the most people have watched, all in one list.'],
  favorite: ['Most favourited anime', 'Fan favourites: the anime people love the most.'],
  upcoming: ['Upcoming anime', 'Anime coming soon, with start dates and trailers.'],
  season: ['Anime this season', 'Every new anime this season, sorted by popularity.'],
  completed: ['Recently completed anime', 'Anime that just finished airing, ready to binge.'],
};
const STATIC = {
  '': ['animee: watch anime in sub and dub', DEFAULT_DESC, 'daily', '1.0'],
  search: ['Browse anime by genre, season and score', 'Find anime by genre, type, season, year, score and status.', 'weekly', '0.8'],
  schedule: ['Anime airing schedule this week', 'What airs each day this week, shown in your own time zone.', 'daily', '0.8'],
  az: ['Anime A-Z list', 'Every anime title from A to Z.', 'weekly', '0.6'],
  pick: ['Help me pick an anime', 'Answer a few questions and get an anime to watch tonight.', 'monthly', '0.5'],
};
// Personal pages: useful for people, nothing for search results.
const PRIVATE = new Set(['watchlist', 'settings', 'account', 'random', 'new', 'stats', 'me', 'requests', 'admin']);
const SHORTCUTS = new Set(['tv', 'movies', 'ova', 'ona', 'specials', 'airing', 'upcoming']);

const WEBSITE_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE,
  alternateName: 'animee space',
  url: ORIGIN + '/',
  potentialAction: { '@type': 'SearchAction', target: ORIGIN + '/search?q={search_term_string}', 'query-input': 'required name=search_term_string' },
};

/** Works out what one path should look like in search results. Returns null for unknown paths. */
export async function describe(url, site = 'animee') {
  // cinemee: movie and TV pages get their own titles in phase 2; until then every page is the app.
  if (site === 'cinemee') {
    const first = url.pathname.split('/').filter(Boolean)[0];
    return {
      status: 200, title: 'cinemee: watch movies and TV', description: CINEMEE_DESC, image: CINEMEE_ORIGIN + '/og.png', imageIsWide: true,
      canonical: first ? null : CINEMEE_ORIGIN + '/', robots: first ? 'noindex, follow' : null,
    };
  }
  const parts = url.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const [first, second, third] = parts;

  if (!first) return { status: 200, title: STATIC[''][0], description: DEFAULT_DESC, canonical: ORIGIN + '/', ld: [WEBSITE_LD] };
  if (STATIC[first] && !second) {
    const [title, description] = STATIC[first];
    // Searches and filtered schedules are endless variations of one page.
    const noindex = first === 'search' && url.search !== '';
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: ORIGIN + '/' + first, robots: noindex ? 'noindex, follow' : null };
  }
  if (first === 'top' && LISTS[second] && !third) {
    const [title, description] = LISTS[second];
    return { status: 200, title: `${title} · ${SITE}`, description, canonical: `${ORIGIN}/top/${second}` };
  }
  if (PRIVATE.has(first) && !second) return { status: 200, title: SITE, description: DEFAULT_DESC, robots: 'noindex, follow' };
  if (SHORTCUTS.has(first) && !second) return { status: 200, title: SITE, description: DEFAULT_DESC, robots: 'noindex, follow' };

  if ((first === 'anime' || first === 'watch') && /^\d{1,12}$/.test(second || '') && (first === 'anime' ? parts.length <= 3 : parts.length === 2)) {
    let anime;
    try { anime = await tenrai.getAnime(second); }
    catch (error) {
      if (error?.status === 404 || error?.status === 400) return { status: 404 };
      return { status: 200, title: SITE, description: DEFAULT_DESC, transient: true }; // catalogue hiccup: serve the app, cache nothing
    }
    const path = animePath(anime);
    const name = anime.title || anime.titleRomaji || 'Anime';
    const format = FORMAT[anime.format] || 'Anime';
    const genres = (anime.genres || []).slice(0, 3).join(', ');
    if (first === 'anime') {
      // One address per show: /anime/123 and old slugs redirect to the current slug.
      if ((third || '') !== path.split('/')[3]) return { redirect: ORIGIN + path + url.search };
      const year = anime.year ? ` (${anime.year})` : '';
      const count = anime.episodes ? `, ${anime.episodes} episode${anime.episodes === 1 ? '' : 's'}` : '';
      const lead = `Watch ${name}${year} online${count}, subbed and dubbed where available${genres ? `. ${genres}` : ''}.`;
      return {
        status: 200,
        title: `${name}${year}: watch ${format === 'Movie' ? 'the movie' : 'every episode'} · ${SITE}`,
        description: clip(`${lead} ${anime.description || ''}`, 158),
        canonical: ORIGIN + path,
        image: anime.cover,
        type: format === 'Movie' ? 'video.movie' : 'video.tv_show',
        ld: [animeLd(anime, path), breadcrumbs([[name, ORIGIN + path]])],
        noscript: animeNoscript(anime, path),
      };
    }
    const ep = Math.max(1, Math.min(2000, Number(url.searchParams.get('ep')) || 1));
    return {
      status: 200,
      title: `Watch ${name} episode ${ep} · ${SITE}`,
      description: clip(`Watch ${name} episode ${ep} in sub or dub. ${anime.description || ''}`, 158),
      canonical: `${ORIGIN}/watch/${anime.id}?ep=${ep}`,
      image: anime.cover,
      type: 'video.episode',
      ld: [breadcrumbs([[name, ORIGIN + path], [`Episode ${ep}`, `${ORIGIN}/watch/${anime.id}?ep=${ep}`]])],
    };
  }
  return null;
}

function animeLd(a, path) {
  const movie = a.format === 'MOVIE';
  const date = (d) => (d?.year ? [d.year, d.month, d.day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, '0') : n)).join('-') : undefined);
  return {
    '@context': 'https://schema.org',
    '@type': movie ? 'Movie' : 'TVSeries',
    name: a.title,
    alternateName: [a.titleRomaji, a.titleNative, ...(a.synonyms || [])].filter((t) => t && t !== a.title).slice(0, 5),
    url: ORIGIN + path,
    image: a.cover || undefined,
    description: clip(a.description, 500) || undefined,
    genre: a.genres?.length ? a.genres : undefined,
    inLanguage: 'ja',
    ...(movie ? { datePublished: date(a.startDate) } : { startDate: date(a.startDate), endDate: date(a.endDate), numberOfEpisodes: a.episodes || undefined }),
    productionCompany: a.studios?.length ? a.studios.slice(0, 3).map((s) => ({ '@type': 'Organization', name: typeof s === 'string' ? s : s?.name })).filter((s) => s.name) : undefined,
  };
}
function breadcrumbs(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['Home', ORIGIN + '/'], ...items].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
  };
}
// Plain HTML for crawlers that don't run scripts. Browsers with JavaScript never show it.
function animeNoscript(a, path) {
  return `<noscript><article><h1>${esc(a.title)}</h1>${a.titleRomaji && a.titleRomaji !== a.title ? `<p>${esc(a.titleRomaji)}</p>` : ''}
<p>${esc(clip(a.description, 900))}</p>
<p>${esc([FORMAT[a.format], a.year, a.episodes ? `${a.episodes} episodes` : '', ...(a.genres || [])].filter(Boolean).join(' · '))}</p>
<p><a href="/watch/${a.id}?ep=1">Watch episode 1</a> · <a href="${esc(path)}">${esc(a.title)}</a></p></article></noscript>`;
}

/** Puts the page's head tags into index.html. */
export function render(html, page, site = 'animee') {
  const cinemee = site === 'cinemee';
  const title = esc(page.title || (cinemee ? 'cinemee' : SITE));
  const description = esc(page.description || (cinemee ? CINEMEE_DESC : DEFAULT_DESC));
  const image = esc(page.image || (cinemee ? CINEMEE_ORIGIN + '/og.png' : OG_IMAGE));
  const wideImage = !page.image || page.imageIsWide;
  const tags = [
    `<meta name="description" content="${description}">`,
    `<meta name="robots" content="${page.status === 404 ? 'noindex, nofollow' : esc(page.robots || 'index, follow, max-image-preview:large')}">`,
    page.canonical ? `<link rel="canonical" href="${esc(page.canonical)}">` : '',
    `<meta property="og:site_name" content="${cinemee ? 'cinemee' : 'animee'}">`,
    `<meta property="og:type" content="${esc(page.type || 'website')}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    page.canonical ? `<meta property="og:url" content="${esc(page.canonical)}">` : '',
    `<meta property="og:image" content="${image}">`,
    wideImage ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '',
    `<meta name="twitter:card" content="${wideImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    ...(page.ld || []).map((data) => `<script type="application/ld+json">${ldJson(data)}</script>`),
  ].filter(Boolean).join('\n  ');
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description"[^>]*>\s*/, '')
    .replace(/<meta name="robots"[^>]*>\s*/, '')
    .replace('</head>', `  ${tags}\n</head>`);
  if (page.noscript) out = out.replace('<main id="app" class="container"></main>', `<main id="app" class="container">${page.noscript}</main>`);
  return out;
}

export function robots(site = 'animee') {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /watchlist',
    'Disallow: /settings',
    'Disallow: /account',
    'Disallow: /random',
    'Disallow: /me',
    'Disallow: /new',
    'Disallow: /stats',
    'Disallow: /requests',
    'Disallow: /admin',
    '',
    `Sitemap: ${site === 'cinemee' ? CINEMEE_ORIGIN : ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
}

// The sitemap lists the fixed pages plus a few hundred shows from the popular, airing, seasonal
// and upcoming lists. Shows hidden from browsing are left out on purpose.
const SITEMAP_SOURCES = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((page) => `/top/anime?filter=bypopularity&page=${page}`),
  ...[1, 2, 3].map((page) => `/top/anime?filter=airing&page=${page}`),
  ...[1, 2].map((page) => `/top/anime?filter=favorite&page=${page}`),
  '/seasons/now?page=1', '/seasons/now?page=2', '/seasons/upcoming?page=1',
];
export async function sitemap(site = 'animee') {
  if (site === 'cinemee') {
    // Phase 1: the home page only; movie and TV pages are added with the TMDB catalogue.
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${CINEMEE_ORIGIN}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`;
  }
  const today = new Date().toISOString().slice(0, 10);
  const urls = Object.entries(STATIC).map(([path, [, , freq, priority]]) => ({ loc: ORIGIN + '/' + path, freq, priority }));
  for (const name of Object.keys(LISTS)) urls.push({ loc: `${ORIGIN}/top/${name}`, freq: 'daily', priority: '0.7' });
  const seen = new Set();
  for (const source of SITEMAP_SOURCES) {
    const payload = await tenrai.request(`${source}&limit=25&sfw-strict=true`).catch(() => null);
    for (const anime of (Array.isArray(payload?.data) ? payload.data : []).map(tenrai.normalizeAnime)) {
      if (!anime.id || seen.has(anime.id) || tenrai.isBrowseHidden(anime)) continue;
      seen.add(anime.id);
      urls.push({ loc: ORIGIN + animePath(anime), freq: anime.status === 'RELEASING' ? 'daily' : 'weekly', priority: '0.6' });
    }
  }
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${today}</lastmod><changefreq>${u.freq}</changefreq><priority>${u.priority}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
