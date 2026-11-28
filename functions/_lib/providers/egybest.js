// cinemee's Altair: Vipserver (vipserver.liiivideo.com), found through sites that host it:
// an EgyBest copy (iegybest.cimawbas.tv) first, then two MyCima copies (cima.my-cima.net,
// vid.mycima.cc), which have older titles the first lacks. Same site software, same pages.
// EGYBEST_URL (comma-separated) replaces the list when a domain moves.
// A site that answers with a Cloudflare challenge or not at all is skipped for 30 minutes; we
// never try to get past a challenge. (Nov 28, 2026: the MyCima copies challenged Node's fetch()
// from a home connection but answered the Worker; e.cimalight.co is the same software but shows
// no server list, so it isn't used.)
//
// Vipserver is a file host with no catalogue: each upload has a random code that only the site
// that uploaded it knows. So: search the site by the title's names (English, original, Arabic),
// pick the film (name + year) or the episode ("الموسم الثاني الحلقة 6" = season 2, episode 6),
// open its play page and take the Vipserver player from the server list.
// Tested Nov 28, 2026: plays inside our no-popups sandbox with no ads, but only when the frame
// sends no referrer ("Video embed restricted for this domain" otherwise); see public/js/player.js.
// The site has newer films and big shows; older titles are often missing (404, next server).

import * as tmdb from './tmdb.js';

export const DEFAULT_SITES = ['https://iegybest.cimawbas.tv', 'https://cima.my-cima.net', 'https://vid.mycima.cc'];
export const DEFAULT_SITE = DEFAULT_SITES[0];
export const PLAYER_ORIGIN = 'https://vipserver.liiivideo.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const fail = (status, message) => Object.assign(new Error(message), { status });

const cleanOrigin = (raw) => {
  try {
    const url = new URL(String(raw || '').trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
};
/** The sites to look in, in order. */
export function siteUrls(env = {}) {
  const own = String(env.EGYBEST_URL || '').split(',').map(cleanOrigin).filter(Boolean);
  return own.length ? [...new Set(own)] : DEFAULT_SITES;
}

// ---------- names ----------
/** Compare names the way people write them: no case, punctuation, Arabic diacritics or letter variants. */
export function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/&amp;/g, '&').replace(/&#0?39;|&quot;/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const SEASON_WORDS = ['الاول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
/** "الثاني" → 2, "الحادي عشر" → 11, "3" → 3. */
export function seasonNumber(word) {
  const w = normName(word);
  if (/^\d{1,2}$/.test(w)) return Number(w);
  if (w === 'الاولي') return 1;
  if (w === 'الحادي عشر') return 11;
  const teen = w.match(/^(\S+) عشر$/);
  if (teen) { const n = SEASON_WORDS.indexOf(teen[1]); return n >= 1 && n <= 8 ? n + 11 : null; }
  const n = SEASON_WORDS.indexOf(w);
  return n >= 0 ? n + 1 : null;
}

/** One listing title → what it is. Films: "مشاهدة فيلم Oppenheimer 2023 مترجم …"; episodes:
 *  "مسلسل Breaking Bad الموسم الخامس الحلقة 16 …" (one-season shows leave the season out). */
export function parseTitle(raw) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim();
  const ep = t.match(/مسلسل\s+(.+?)\s+(?:الموسم\s+(.+?)\s+)?الحلقة\s+(\d{1,4})(?!\d)/);
  if (ep) {
    const season = ep[2] ? seasonNumber(ep[2]) : 1;
    return season ? { kind: 'episode', name: normName(ep[1]), season, episode: Number(ep[3]) } : null;
  }
  const film = t.match(/فيلم\s+(.+?)\s+((?:19|20)\d{2})(?!\d)/);
  if (film) return { kind: 'movie', name: normName(film[1]), year: Number(film[2]) };
  return null;
}

// ---------- the site ----------
async function get(url, init = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, Referer: new URL(url).origin + '/', Accept: 'text/html,*/*', ...(init.headers || {}) },
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    throw fail(error?.name === 'TimeoutError' ? 504 : 502, 'Altair did not respond.');
  }
  // A Cloudflare challenge page means the site stopped answering servers like ours.
  if (response.headers.get('cf-mitigated') || !response.ok) throw fail(502, `Altair answered ${response.status}.`);
  return response.text();
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');

/** The site's live search (the one behind its search box): [{ vid, title }]. */
export async function search(site, query) {
  const html = await get(site + '/ajax-search.php', {
    method: 'POST',
    body: new URLSearchParams({ queryString: query }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
  });
  return [...html.matchAll(/data-video-id="([a-z0-9]{5,20})"\s*>\s*<a[^>]*>(?:<img[^>]*>)?([^<]+)/g)]
    .map((m) => ({ vid: m[1], title: decode(m[2]).trim() }));
}

/** Every episode page also lists the rest of the show: [{ vid, title }]. */
export async function relatedEpisodes(site, vid) {
  const html = await get(`${site}/watch.php?vid=${encodeURIComponent(vid)}`);
  return [...html.matchAll(/watch\.php\?vid=([a-z0-9]{5,20})"[^>]*\btitle="([^"]+)"/g)]
    .map((m) => ({ vid: m[1], title: decode(m[2]).trim() }));
}

/** The Vipserver player for one video, or null when the site has other servers only. */
export async function vipserverFor(site, vid) {
  const html = await get(`${site}/play.php?vid=${encodeURIComponent(vid)}`);
  for (const m of html.matchAll(/id="server_(\w+)"[^>]*data-embed="<iframe src='([^']+)'/g)) {
    if (!/vip/i.test(m[1])) continue;
    try {
      const url = new URL(m[2]);
      if (url.origin === PLAYER_ORIGIN && /^\/embed-[a-z0-9]+\.html$/i.test(url.pathname)) return url.origin + url.pathname;
    } catch { /* not a URL */ }
  }
  return null;
}

/** Find the site's video id for a film or an episode. */
export async function findVideo(site, { type, names, year, season, episode }) {
  const wanted = new Set(names.map(normName).filter(Boolean));
  const isMatch = (p) => p && wanted.has(p.name) && (type === 'movie'
    ? p.kind === 'movie' && (!year || Math.abs(p.year - year) <= 1)
    : p.kind === 'episode' && p.season === season && p.episode === episode);
  let showPage = null; // any episode of the right show: its page lists the others
  for (const name of names) {
    const hits = await search(site, name);
    for (const hit of hits) {
      const parsed = parseTitle(hit.title);
      if (isMatch(parsed)) return hit.vid;
      if (!showPage && type === 'tv' && parsed?.kind === 'episode' && wanted.has(parsed.name)) showPage = hit.vid;
    }
    if (showPage) break;
  }
  if (!showPage) return null;
  const listed = await relatedEpisodes(site, showPage);
  return listed.find((item) => isMatch(parseTitle(item.title)))?.vid || null;
}

// Per site and title: found players keep for hours (the codes don't change), misses for an hour.
// A site that is down or shows a challenge is skipped for a while.
const cache = new Map();
const down = new Map(); // site -> until
const HIT_MS = 6 * 60 * 60 * 1000;
const MISS_MS = 60 * 60 * 1000;
const DOWN_MS = 30 * 60 * 1000;
// The player gives a server 8 s; stop starting new sites after this much.
export const limits = { startBeforeMs: 5500 };
export function resetCache() { cache.clear(); down.clear(); }

async function lookup(site, rawId, target) {
  const key = `${site}|${target.type}|${target.tmdb}|${target.season || 0}|${target.episode || 0}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.embedUrl;
  const { names, year } = await tmdb.titleNames(rawId);
  const vid = await findVideo(site, { type: target.type, names, year, season: target.season, episode: target.episode });
  const embedUrl = vid ? await vipserverFor(site, vid) : null;
  cache.set(key, { embedUrl, expires: Date.now() + (embedUrl ? HIT_MS : MISS_MS) });
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  return embedUrl;
}

export async function getSources(rawId, rawEpisode, env = {}) {
  const target = await tmdb.episodeTarget(rawId, rawEpisode);
  const started = Date.now();
  let outages = 0;
  let tried = 0;
  for (const site of siteUrls(env)) {
    if ((down.get(site) || 0) > Date.now()) { outages += 1; continue; }
    if (tried && Date.now() - started > limits.startBeforeMs) break;
    tried += 1;
    try {
      const embedUrl = await lookup(site, rawId, target);
      if (embedUrl) return { embedUrl, embedOrigin: PLAYER_ORIGIN, language: 'sub', provider: 'egybest', events: [] };
    } catch (error) {
      if (error?.status && error.status < 500) throw error; // a bad title id, not the site
      down.set(site, Date.now() + DOWN_MS);
      outages += 1;
      console.warn(`altair: ${new URL(site).hostname} skipped for 30 min: ${error?.message || error}`);
    }
  }
  // Only outages and nothing found anywhere: an outage. Otherwise: they don't have it.
  if (outages && outages === siteUrls(env).length) throw fail(502, 'Altair is unavailable right now.');
  throw fail(404, target.type === 'movie' ? 'Altair doesn\'t have this film.' : 'Altair doesn\'t have this episode.');
}
