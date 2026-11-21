// One Worker serves two sites: animee (anime, animee.space) and cinemee (movies and TV,
// cinemee.animee.space). The address decides which one a request belongs to.
//
// cinemee keeps its own saved data in its own D1 database (binding CINEMEE_DB), so accounts,
// lists, reports, requests and pop-up subscriptions never mix between the two sites.

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
};

/** 'cinemee' for cinemee.animee.space (and cinemee.localhost in development), else 'animee'. */
export function siteOf(url) {
  const host = new URL(url).hostname;
  return /^cinemee\./.test(host) ? 'cinemee' : 'animee';
}

/** The environment one request sees: cinemee swaps in its own database. */
export function siteEnv(env, site) {
  if (site !== 'cinemee') return { ...env, SITE: 'animee' };
  return { ...env, SITE: 'cinemee', DB: env.CINEMEE_DB };
}

// cinemee's red, the counterpart of animee's lime (CSS tokens live in public/css/style.css).
export const CINEMEE_RED = { hex: '#FF3D52', rgb: '255,61,82' };

// TMDB's terms ask every site using its API to show this notice.
const TMDB_CREDIT = '<p class="footer-credit">Movie and TV data from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>. '
  + 'This product uses the TMDB API but is not endorsed or certified by TMDB. '
  + 'TV air times from <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a>.</p>';

/** index.html with the site's own name, wordmark and wording (animee's shell is the default). */
export function brandShell(html, site) {
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

/** The offline page inside sw.js, in the site's colour and name. */
export function brandServiceWorker(js, site) {
  if (site !== 'cinemee') return js;
  return js
    .replace(/#C6FF3D/gi, CINEMEE_RED.hex)
    .replace(/rgba\(198,255,61,/g, `rgba(${CINEMEE_RED.rgb},`)
    .replace('Offline · animee space', 'Offline · cinemee');
}
