// One Worker serves three sites: animee (anime, animee.space), cinemee (movies and TV,
// cinemee.animee.space) and mangee (manga from MangaDex, mangee.animee.space). The address
// decides which one a request belongs to.
//
// Accounts are shared (animee's database); each site keeps its own lists, progress, reports,
// requests and pop-up subscriptions in its own D1 database (DB, CINEMEE_DB, MANGEE_DB).

export const SITES = {
  animee: {
    id: 'animee',
    name: 'animee',
    title: 'animee space',
    origin: 'https://animee.space',
    word: 'anim', // the wordmark is "anim" + the ^^. eyes
    themeColor: '#08090A',
  },
  cinemee: {
    id: 'cinemee',
    name: 'cinemee',
    title: 'cinemee',
    origin: 'https://cinemee.animee.space',
    word: 'cinem',
    themeColor: '#08090A',
  },
  mangee: {
    id: 'mangee',
    name: 'mangee',
    title: 'mangee',
    origin: 'https://mangee.animee.space',
    word: 'mang',
    themeColor: '#08090A',
  },
};

/** 'cinemee' / 'mangee' for their subdomains (and *.localhost in development), else 'animee'. */
export function siteOf(url) {
  const host = new URL(url).hostname;
  if (/^cinemee\./.test(host)) return 'cinemee';
  if (/^mangee\./.test(host)) return 'mangee';
  return 'animee';
}

/** The environment one request sees: cinemee swaps in its own database. */
// Accounts are shared by every site (animee's database: USERS_DB); lists and progress live in the
// site's own database (DB).
export function siteEnv(env, site) {
  if (site === 'cinemee') return { ...env, SITE: 'cinemee', DB: env.CINEMEE_DB, USERS_DB: env.DB };
  if (site === 'mangee') return { ...env, SITE: 'mangee', DB: env.MANGEE_DB, USERS_DB: env.DB };
  return { ...env, SITE: 'animee', USERS_DB: env.DB };
}

// cinemee's red and mangee's neon yellow, the counterparts of animee's lime (CSS tokens live
// in public/css/style.css).
export const CINEMEE_RED = { hex: '#FF3D52', rgb: '255,61,82' };
export const MANGEE_YELLOW = { hex: '#FFE81F', rgb: '255,232,31' };

// MangaDex's usage policy: credit MangaDex and the scanlation groups (each chapter names its
// group in the reader), no ads.
const MANGADEX_CREDIT = '<p class="footer-credit">Manga from <a href="https://mangadex.org/" target="_blank" rel="noopener">MangaDex</a>. '
  + 'Chapters are by their scanlation groups, credited on every chapter. mangee is not affiliated with MangaDex and shows no ads.</p>';

// TMDB's terms ask every site using its API to show this notice.
const TMDB_CREDIT = '<p class="footer-credit">Movie and TV data from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>. '
  + 'This product uses the TMDB API but is not endorsed or certified by TMDB. '
  + 'TV air times from <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a>.</p>';

/** index.html with the site's own name, wordmark and wording (animee's shell is the default). */
export function brandShell(html, site) {
  if (site === 'mangee') return brandMangee(html);
  if (site !== 'cinemee') return html;
  const swaps = [
    ['<html lang="en">', '<html lang="en" data-site="cinemee">'],
    ['<title>animee space</title>', '<title>cinemee</title>'],
    [/aria-label="animee, home"/g, 'aria-label="cinemee, home"'],
    [/aria-hidden="true">anim<svg class="wm-eyes"/g, 'aria-hidden="true">cinem<svg class="wm-eyes"'],
    [/Search anime/g, 'Search movies and TV'],
    ['>My Anime <span', '>My List <span'],
    ['watch anime. stay happy.', 'watch movies. stay happy.'],
    // Footer links: there's no A-Z for movies (TMDB can't list by first letter).
    ['<a href="/az">A-Z list</a>', ''],
    ['<a href="/top/airing">Top airing</a>', '<a href="/top/airing">On TV this week</a>'],
    ['<a href="/top/popular">Most popular</a>', '<a href="/top/popular">Trending</a>'],
    ['<a class="sibling-link" href="https://cinemee.animee.space/">cinemee: movies &amp; TV ↗</a>', '<a class="sibling-link" href="https://animee.space/">animee: anime ↗</a>'],
    ['<p class="footer-tag">watch movies. stay happy.</p>', '<p class="footer-tag">watch movies. stay happy.</p>\n        ' + TMDB_CREDIT],
  ];
  let out = html;
  for (const [from, to] of swaps) out = typeof from === 'string' ? out.replace(from, to) : out.replace(from, to);
  return out;
}

function brandMangee(html) {
  const swaps = [
    ['<html lang="en">', '<html lang="en" data-site="mangee">'],
    ['<title>animee space</title>', '<title>mangee</title>'],
    [/aria-label="animee, home"/g, 'aria-label="mangee, home"'],
    [/aria-hidden="true">anim<svg class="wm-eyes"/g, 'aria-hidden="true">mang<svg class="wm-eyes"'],
    [/Search anime/g, 'Search manga'],
    ['>My Anime <span', '>My Manga <span'],
    ['<a href="/schedule" data-nav="schedule">Schedule</a>', '<a href="/top/airing" data-nav="latest">Latest</a>'],
    ['watch anime. stay happy.', 'read manga. stay happy.'],
    // MangaDex can't list by first letter, and manga has no airing schedule.
    ['<a href="/az">A-Z list</a>', ''],
    ['<a href="/schedule">Schedule</a>', ''],
    ['<a href="/top/airing">Top airing</a>', '<a href="/top/airing">Latest updates</a>'],
    ['<a class="sibling-link" href="https://cinemee.animee.space/">cinemee: movies &amp; TV ↗</a>', '<a class="sibling-link" href="https://animee.space/">animee: anime ↗</a>'],
    ['<p class="footer-tag">read manga. stay happy.</p>', '<p class="footer-tag">read manga. stay happy.</p>\n        ' + MANGADEX_CREDIT],
  ];
  let out = html;
  for (const [from, to] of swaps) out = out.replace(from, to);
  return out;
}

/** The offline page inside sw.js, in the site's colour and name. */
export function brandServiceWorker(js, site) {
  const colour = site === 'cinemee' ? CINEMEE_RED : site === 'mangee' ? MANGEE_YELLOW : null;
  if (!colour) return js;
  return js
    .replace(/#C6FF3D/gi, colour.hex)
    .replace(/rgba\(198,255,61,/g, `rgba(${colour.rgb},`)
    .replace('Offline · animee space', `Offline · ${site}`);
}
