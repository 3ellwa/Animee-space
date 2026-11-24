import './compat.js'; // first: fills gaps in older (TV) browsers before anything else runs
import { api } from './api.js';
import * as store from './store.js';
import { Player } from './player.js';
import './fx.js';
import { initTv, isTv } from './tv.js';
import * as inbox from './inbox.js';
import * as push from './push.js';
import * as aniList from './anilist.js';
import { BRAND, IS_CINEMEE, IS_MANGEE, SIBLING, WORDS } from './site.js';
import { viewAccount } from './views/account.js';
import { viewAdmin } from './views/admin.js';
import { viewAZ, viewPick, viewSchedule } from './views/discover.js';
import { showNews, viewMe, viewNew, viewRequests } from './views/hub.js';
import { viewShared, viewStats, viewWatchlist } from './views/lists.js';
import { viewSettings } from './views/settings.js';
import { viewWatch } from './views/watch.js';
import { viewRead } from './views/read.js';

export const app = document.getElementById('app');
export let cleanups = [];
export let navToken = 0;

// ---------- helpers ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const FORMAT = { TV: IS_CINEMEE ? 'TV series' : 'TV', TV_SHORT: 'TV Short', TV_SPECIAL: 'TV Special', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music', MANGA: 'Manga', MANHWA: 'Manhwa', MANHUA: 'Manhua', ONE_SHOT: 'Oneshot' };
export const STATUS = IS_CINEMEE
  ? { RELEASING: 'On air', FINISHED: 'Complete', NOT_YET_RELEASED: 'Coming soon', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
  : IS_MANGEE
    ? { RELEASING: 'Ongoing', FINISHED: 'Completed', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
    : { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' };
export const SEASON = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
export const TYPE_OPTIONS = IS_CINEMEE ? [['movie', 'Movie'], ['tv', 'TV show']]
  : [['tv', 'TV series'], ['movie', 'Movie'], ['ova', 'OVA'], ['ona', 'ONA'], ['special', 'Special'], ['music', 'Music']];
export const STATUS_OPTIONS = IS_CINEMEE ? [['airing', 'On air now'], ['upcoming', 'Coming soon']]
  : [['airing', 'Airing now'], ['complete', 'Finished'], ['upcoming', 'Not aired yet']];
export const SEASON_OPTIONS = [['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall']];
export const RATING_OPTIONS = [['g', 'G, all ages'], ['pg', 'PG, children'], ['pg13', 'PG-13, teens'], ['r17', 'R, 17+']];
export const ORDER_OPTIONS = [['popular', 'Most popular'], ['score', 'Best rated'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['title', 'Title A-Z']];
export const LIST_TITLES = IS_CINEMEE
  ? { airing: 'On TV this week', popular: 'Trending this week', favorite: 'Top rated', upcoming: 'Coming to cinemas', season: 'In cinemas now', completed: 'Complete series' }
  : { airing: 'Top airing', popular: 'Most popular', favorite: 'Most favourited', upcoming: 'Coming soon', season: 'This season', completed: 'Just completed' };
// Short paths that open the browse page with a preset filter.
export const SHORTCUTS = IS_CINEMEE ? { tv: 'type=tv', movies: 'type=movie', airing: 'status=airing', upcoming: 'status=upcoming' }
  : { tv: 'type=tv', movies: 'type=movie', ova: 'type=ova', ona: 'type=ona', specials: 'type=special', airing: 'status=airing', upcoming: 'status=upcoming' };
export const MAX_GENRES = 5;
// cinemee ids end in 1 for movies and 2 for TV (see functions/_lib/providers/tmdb.js).
export const isMovie = (a) => IS_CINEMEE && (a?.format === 'MOVIE' || /1$/.test(String(a?.id ?? a?.animeId ?? '')));
// "S1 · E3" for TV episodes on cinemee, "Episode 3" everywhere else.
export const epName = (ep) => (ep?.label ? ep.label : `Episode ${ep?.number ?? ep}`);
// How long a title is, for chips and cards.
export function lengthLabel(a) {
  if (IS_MANGEE) return a.availableEpisodes ? plural(a.availableEpisodes, 'chapter') : (a.episodes ? plural(a.episodes, 'chapter') : '');
  if (!IS_CINEMEE) return `${epsLabel(a)} eps`;
  if (isMovie(a)) return a.duration ? `${Math.floor(a.duration / 60) ? `${Math.floor(a.duration / 60)}h ` : ''}${a.duration % 60}m` : '';
  return [a.seasonCount ? `${a.seasonCount} season${a.seasonCount === 1 ? '' : 's'}` : '', a.availableEpisodes ? plural(a.availableEpisodes, 'episode') : ''].filter(Boolean).join(' · ');
}
export const score = (s) => (s ? (s / 10).toFixed(1) : null);
export const fmtDate = (d) => (d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', ...(d.day ? { day: 'numeric' } : {}) }) : '?');
export const fmtCountdown = (sec) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
// The brand's ^^. face. Its eyes blink, and the loader bounces the dot.
export const HAPPY = '<svg class="happy" viewBox="0 0 48 24" aria-hidden="true"><path class="eye" d="M3 20.5 L10 6 L17 20.5"/><path class="eye" d="M24 20.5 L31 6 L38 20.5"/><circle class="dot" cx="45" cy="20.6" r="2.9"/></svg>';
export const loader = () => `<div class="loader" role="status"><span class="loader-face">${HAPPY}</span><span class="sr-only">Loading</span></div>`;
export const onCleanup = (fn) => cleanups.push(fn);
// 754 -> "12:34", 3800 -> "1:03:20"
export const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
// The title to show, following the English / Japanese setting.
export const T = (a) => (store.getSettings().titles === 'japanese' && a?.titleRomaji ? a.titleRomaji : a?.title || '');
// Rows and picks leave out shows marked "Not interested", and shows already started when that setting is on.
export const unstarted = (list) => {
  const hidden = store.notInterestedIds();
  if (store.getSettings().hideStarted) for (const id of store.startedIds()) hidden.add(id);
  return withoutHiddenGenres(hidden.size ? list.filter((a) => !hidden.has(String(a.id))) : list);
};
// Settings → Hide genres: shows in those genres stay out of rows, picks and browsing.
export function withoutHiddenGenres(list, except = []) {
  const skip = (store.getSettings().hiddenGenres || []).filter((g) => !except.includes(g));
  if (!skip.length) return list;
  return list.filter((a) => !(a.genres || []).some((g) => skip.includes(g)));
}
// Reads a file the viewer picked as text.
export const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsText(file);
});

export function epsLabel(a) {
  const have = Number(a.availableEpisodes ?? a.episodes) || 0;
  
  return have || a.episodes || '?';
}

/** "1 episode", "2 episodes". */
export const plural = (n, word, many = `${word}s`) => `${Number(n).toLocaleString()} ${Number(n) === 1 ? word : many}`;

// Every card remembers its show, so the poster's save button can add it without another lookup.
export const cardShows = new Map();
export function card(a) {
  if (a?.id) cardShows.set(String(a.id), a);
  const saved = store.getEntry(a.id);
  return `<a class="card" href="${animeHref(a)}" data-card="${esc(a.id)}">
    <div class="poster" style="--c:${esc(a.color || '#1e1a2b')}">
      <button class="card-save${saved?.status || saved?.favourite ? ' on' : ''}" type="button" data-save="${esc(a.id)}" aria-label="Save ${esc(T(a))}">${saved?.status || saved?.favourite ? '✓' : '＋'}</button>
      <img loading="lazy" src="${esc(a.cover)}" alt="${esc(T(a))} poster">
      ${a.score ? `<span class="badge score">★ ${score(a.score)}</span>` : ''}
      ${store.getRating(a.id) ? `<span class="badge mine" title="Your rating">you ${store.getRating(a.id)}/10</span>` : ''}
      ${a.status === 'RELEASING' ? '<span class="badge airing">Airing</span>' : ''}
      ${FORMAT[a.format] === 'Movie' ? '<span class="badge eps">Movie</span>'
        : !IS_CINEMEE && epsLabel(a) !== '?' ? `<span class="badge eps">${epsLabel(a)} eps</span>` : ''}
    </div>
    <div class="card-title">${esc(T(a))}</div>
    <div class="card-meta">${a.relation ? esc(a.relation) : [FORMAT[a.format], a.year].filter(Boolean).join(' · ')}</div>
  </a>`;
}

// Next weekly broadcast as a timestamp. Broadcast times are given in Japan time (UTC+9).
export const BROADCAST_DAYS = ['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays'];
export function nextBroadcast(b) {
  if (!b || (b.timezone && b.timezone !== 'Asia/Tokyo')) return null;
  const day = BROADCAST_DAYS.indexOf(String(b.day).toLowerCase());
  const [h, m] = String(b.time).split(':').map(Number);
  if (day < 0 || !Number.isFinite(h) || !Number.isFinite(m)) return null;
  const JST = 9 * 3600e3;
  const now = Date.now();
  const jst = new Date(now + JST);
  const ahead = (day - (jst.getUTCDay() + 6) % 7 + 7) % 7;
  let at = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + ahead, h, m) - JST;
  if (at < now) at += 7 * 86400e3;
  return at;
}
export const localTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// A shelf: one horizontal row of posters with arrow buttons. Its list loads the first time the
// row comes near the screen, so the home page doesn't ask for every list at once.
export function shelf(id, title, sub, more = '') {
  return `<section class="section shelf" id="${id}">
    <div class="section-head">
      <div class="shelf-title"><h2>${title}</h2>${sub ? `<p class="shelf-sub">${sub}</p>` : ''}</div>
      <div class="shelf-nav">${more}<button class="arrow" data-dir="-1" aria-label="Scroll left" disabled>‹</button><button class="arrow" data-dir="1" aria-label="Scroll right">›</button></div>
    </div>
    <div class="shelf-track">${loader()}</div>
  </section>`;
}
export const shelfCards = (list) => list.map(card).join('');
// Top 10 as a shelf: a big outlined rank number leaning on each poster.
export const rankCards = (list) => list.map((a, i) => `<a class="rank-card" href="${animeHref(a)}" title="${esc(T(a))}">
    <span class="rank-num">${i + 1}</span>
    <span class="poster"><img loading="lazy" src="${esc(a.cover)}" alt="${esc(T(a))} poster"></span>
    <span class="rank-title">${esc(T(a))}</span>
  </a>`).join('');
export function bindShelf(id, load, alive) {
  const root = document.getElementById(id);
  if (!root) return;
  const track = root.querySelector('.shelf-track');
  const arrows = [...root.querySelectorAll('.arrow')];
  const sync = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    arrows[0].disabled = track.scrollLeft <= 2;
    arrows[1].disabled = track.scrollLeft >= max;
    root.classList.toggle('at-start', track.scrollLeft <= 2);
    root.classList.toggle('at-end', track.scrollLeft >= max);
  };
  arrows.forEach((b) => b.onclick = () => track.scrollBy({ left: Number(b.dataset.dir) * track.clientWidth * 0.85, behavior: 'smooth' }));
  track.addEventListener('scroll', sync, { passive: true });
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      const html = await load();
      if (!alive()) return;
      if (!html) { root.remove(); return; }
      track.innerHTML = html;
      track.scrollLeft = 0;
      sync();
    } catch (err) {
      if (alive()) track.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  };
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
  io.observe(root);
  onCleanup(() => io.disconnect());
}
export const grid = (list) => (list?.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<div class="empty">Nothing here yet.</div>');
export const section = (title, body, more = '') => `<section class="section"><div class="section-head"><h2>${title}</h2>${more}</div>${body}</section>`;

// Speed and volume per show on our own player, this browser only (the last 200 shows).
export const MEDIA_KEY = 'animee-space:media-prefs';
export function mediaPrefsFor(id) {
  try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}')[id] || null; } catch { return null; }
}
export function saveMediaPrefs(id, p) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}'); } catch { /* ignore */ }
  delete all[id];
  all[id] = { rate: p.rate, volume: p.volume, muted: p.muted };
  const keys = Object.keys(all);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete all[k]);
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// "Popular here": one anonymous count per show per day from this browser (see popular.js).
export function countPlay(id) {
  const key = 'animee-space:played';
  const day = new Date().toDateString();
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* ignore */ }
  if (seen.day !== day) seen = { day, ids: [] };
  if (seen.ids.includes(String(id))) return;
  seen.ids.push(String(id));
  try { localStorage.setItem(key, JSON.stringify(seen)); } catch { /* ignore */ }
  fetch('/api/play', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: String(id) }) }).catch(() => {});
}

export function viewNotFound() {
  app.innerHTML = '<div class="empty lost" data-kao="-_-."><h2>404, this page wandered off</h2><p>The link is broken or the page never existed.</p><a class="btn primary" href="/">Take me home</a></div>';
}


// ---------- router ----------
// Real paths (/anime/52991/frieren-…), so every page can be indexed and shared. Links inside the
// site are handled here without a full reload; old #/ links are converted once on load.
export function parseHash() {
  return { parts: location.pathname.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(location.search) };
}
export const slugify = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// The English title makes the slug, so a show keeps one address whatever the title setting.
// animee: /anime/123/slug. cinemee: /movie/5501/fight-club or /tv/13992/game-of-thrones.
export const animeHref = (a) => `/${IS_CINEMEE ? (/1$/.test(String(a.id)) ? 'movie' : 'tv') : IS_MANGEE ? 'manga' : 'anime'}/${a.id}${a.title ? '/' + slugify(a.title) : ''}`;
export function go(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route();
}

export function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  document.getElementById('nav-links').classList.remove('open');
}

export async function route() {
  cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  cleanups = [];
  const token = ++navToken;
  const alive = () => token === navToken;
  const { parts, query } = parseHash();
  const HUB_PAGES = ['me', 'watchlist', 'new', 'requests', 'stats', 'settings', 'account'];
  setActiveNav(HUB_PAGES.includes(parts[0]) ? 'me' : parts[0] || 'home');
  document.title = BRAND.title;
  window.dispatchEvent(new Event('animee:navigate'));
  window.scrollTo(0, 0);
  app.innerHTML = loader();

  // /tv and /movies alone are browse shortcuts; /tv/13992 is a show page on cinemee.
  if (SHORTCUTS[parts[0]] && !parts[1]) return go('/search?' + SHORTCUTS[parts[0]], { replace: true });

  try {
    switch (parts[0]) {
      case undefined: return await viewHome(alive);
      case 'search': return await viewSearch(query, alive);
      case 'top': return await viewList(parts[1], alive);
      case 'random': return await viewRandom(alive);
      case 'az': return await viewAZ(query, alive);
      case 'pick': return viewPick(alive);
      case 'settings': return viewSettings(alive);
      case 'anime': return await viewAnime(parts[1], alive, query);
      case 'movie': case 'tv': return IS_CINEMEE ? await viewAnime(parts[1], alive, query) : viewNotFound();
      case 'manga': return IS_MANGEE ? await viewAnime(parts[1], alive, query) : viewNotFound();
      case 'read': return IS_MANGEE ? await viewRead(parts[1], query, alive) : viewNotFound();
      // mangee reads chapters at /watch/<id>?ep=N too (every "continue" link works unchanged).
      case 'watch': return IS_MANGEE ? await viewRead(parts[1], query, alive) : await viewWatch(parts[1], query, alive);
      case 'watchlist': return viewWatchlist(query);
      case 'schedule': return await viewSchedule(query, alive);
      case 'new': return await viewNew(alive);
      case 'me': return viewMe();
      case 'requests': return await viewRequests(alive);
      case 'admin': return viewAdmin();
      case 'u': return await viewShared(parts[1], alive, query);
      case 'stats': return viewStats();
      case 'account': return viewAccount(query);
      default: return viewNotFound();
    }
  } catch (err) {
    if (!alive()) return;
    // 4xx answers (bad link, missing title) won't fix themselves, so only offer a retry for the rest.
    const lasting = err.status >= 400 && err.status < 500;
    app.innerHTML = `<div class="error" data-kao="${lasting ? '(._.)' : '(x_x)'}"><h2>${lasting ? 'Nothing here' : "Couldn't load this page"}</h2><p>${esc(err.message)}</p>
      ${lasting ? '<a class="btn primary" href="/">Go home</a>' : '<button class="btn primary" id="retry">Try again</button>'}</div>`;
    document.getElementById('retry')?.addEventListener('click', route);
  }
}

// ---------- home ----------
// No connection: say what still works (everything saved in this browser).
export function offlineNote() {
  return `<div class="empty"><h2>You're offline</h2><p>Your list, history and stats are saved in this browser and still work.</p>
    <p class="actions" style="justify-content:center"><a class="btn primary" href="/watchlist">My list</a> <a class="btn" href="/watchlist?tab=history">History</a> <a class="btn" href="/stats">Stats</a></p></div>`;
}
window.addEventListener('offline', () => toastNote('You’re offline. Your list, history and stats still work.'));
window.addEventListener('online', () => toastNote('Back online.'));

export async function viewHome(alive) {
  if (!navigator.onLine) { app.innerHTML = offlineNote(); return; }
  const d = await api('/home');
  if (!alive()) return;
  const season = d.recent || [];
  const cont = store.getSettings().showContinue ? store.continueList().filter(p => p.title) : [];
  const quick = IS_MANGEE
    ? [['Latest updates', '/top/airing'], ['Most followed', '/top/popular'], ['Top rated', '/top/favorite'], ['Completed', '/top/completed'],
      ['Manhwa', '/search?type=manhwa'], ['Help me pick', '/pick'], ['All filters', '/search'], ['Random', '/random']]
    : IS_CINEMEE
    ? [['Movies', '/movies'], ['TV shows', '/tv'], ['On air now', '/airing'], ['Coming soon', '/upcoming'],
      ['Schedule', '/schedule'], ['Help me pick', '/pick'], ['All filters', '/search'], ['Random', '/random']]
    : [['TV series', '/tv'], ['Movies', '/movies'], ['Airing now', '/airing'], ['Coming soon', '/upcoming'],
      ['Schedule', '/schedule'], ['Help me pick', '/pick'], ['A-Z', '/az'], ['All filters', '/search'], ['Random', '/random']];
  app.innerHTML =
    `<h1 class="sr-only">${BRAND.title}: ${IS_CINEMEE ? 'watch movies and TV' : IS_MANGEE ? 'read manga' : 'watch anime'}</h1>` +
    spotlight(season.filter((x) => !store.notInterestedIds().has(String(x.id))).slice(0, 8)) +
    `<nav class="quick" aria-label="Shortcuts">${quick.map(([label, href]) => `<a class="chip" href="${href}">${label}</a>`).join('')}</nav>` +
    (cont.length ? section(`Continue ${WORDS.watching}`, '<div class="row">' + cont.map(contCard).join('') + '</div>') : '') +
    '<div id="sibling-cont"></div>' +
    '<div id="picked"></div>' +
    (IS_MANGEE
      ? shelf('shelf-top', 'Top 10 right now', 'the most followed series still coming out') +
        '<div id="popular-here"></div>' +
        shelf('shelf-airing', 'Latest updates', 'fresh chapters', '<a href="/top/airing">See all ›</a>') +
        '<div id="sibling-promo"></div>' +
        shelf('shelf-season', 'New on mangee', 'recently added series', '<a href="/top/season">See all ›</a>') +
        shelf('shelf-upcoming', 'Top rated, still going', 'great series with more on the way', '<a href="/top/upcoming">See all ›</a>') +
        shelf('shelf-completed', 'Completed', 'finished, so you can read it all', '<a href="/top/completed">See all ›</a>') +
        shelf('shelf-popular', 'Most followed', 'the series everyone reads', '<a href="/top/popular">See all ›</a>') +
        shelf('shelf-favorite', 'Top rated', 'the best rated of all', '<a href="/top/favorite">See all ›</a>')
      : IS_CINEMEE
      ? shelf('shelf-top', 'Top 10 today', 'what everyone is watching right now') +
        '<div id="popular-here"></div>' +
        shelf('shelf-airing', 'On TV this week', 'new episodes out now', '<a href="/top/airing">See all ›</a>') +
        '<div id="sibling-promo"></div>' +
        shelf('shelf-season', 'In cinemas now', 'the big screen, right now', '<a href="/top/season">See all ›</a>') +
        shelf('shelf-upcoming', 'Coming to cinemas', 'mark your calendar', '<a href="/top/upcoming">See all ›</a>') +
        shelf('shelf-completed', 'Complete series', 'every season out, so you can binge it all', '<a href="/top/completed">See all ›</a>') +
        shelf('shelf-popular', 'Trending this week', 'the ones everybody is talking about', '<a href="/top/popular">See all ›</a>') +
        shelf('shelf-favorite', 'Top rated', 'crowd pleasers that never get old', '<a href="/top/favorite">See all ›</a>')
      : shelf('shelf-top', 'Top 10 this season', 'what everyone is watching right now') +
        '<div id="popular-here"></div>' +
        shelf('shelf-airing', 'Airing now', 'new episodes every week', '<a href="/top/airing">See all ›</a>') +
        '<div id="sibling-promo"></div>' +
        shelf('shelf-season', 'New this season', 'fresh starts worth a first episode', '<a href="/top/season">See all ›</a>') +
        shelf('shelf-upcoming', 'Coming soon', 'mark your calendar', '<a href="/top/upcoming">See all ›</a>') +
        shelf('shelf-completed', 'Just completed', 'finished, so you can binge it all', '<a href="/top/completed">See all ›</a>') +
        shelf('shelf-popular', 'Most popular', 'the ones everybody has seen', '<a href="/top/popular">See all ›</a>') +
        shelf('shelf-favorite', 'Fan favourites', 'crowd pleasers that never get old', '<a href="/top/favorite">See all ›</a>')) +
    '<section class="section" id="home-genres"></section>';
  loadSibling(alive);
  // "Popular on <site> this week": what people here play (only once there's enough to show).
  api('/popular-here').then(({ results }) => {
    if (!alive() || (results || []).length < 6) return;
    const list = unstarted(results).filter((x) => !store.notInterestedIds().has(String(x.id)));
    if (list.length < 4) return;
    const slot = document.getElementById('popular-here');
    if (!slot) return;
    slot.innerHTML = shelf('shelf-here', `Popular on ${BRAND.name} this week`, `what people here are watching`);
    bindShelf('shelf-here', async () => shelfCards(list.slice(0, 20)), alive);
  }).catch(() => {});

  app.querySelectorAll('.cont .x').forEach(b => b.onclick = e => {
    e.preventDefault();
    store.removeProgress(b.dataset.id);
    b.closest('.cont').remove();
  });
  bindSpotlight(alive);
  checkNewEpisodes(cont, alive);
  bindShelf('shelf-top', async () => rankCards(unstarted(season).slice(0, 10)), alive);
  for (const name of ['airing', 'season', 'upcoming', 'completed', 'popular', 'favorite']) {
    bindShelf(`shelf-${name}`, async () => {
      const list = unstarted((await api(`/list/${name}`)).results || []).slice(0, 20);
      return list.length ? shelfCards(list) : '';
    }, alive);
  }

  // "Picked for you": recommendations from the last few shows you watched or saved, mixed, with
  // anything already started or on your list left out. With one show it says which one.
  // Seeds: shows you rated 8+ first, then what you watched or saved lately; never ones you rated 4 or less.
  const lovedShows = store.ratedList().filter((r) => r.rating >= 8 && r.title).sort((x, y) => y.rating - x.rating).map((r) => ({ animeId: r.id, title: r.title }));
  const recentShows = [...lovedShows, ...store.continueList(), ...Object.values(store.getList()).sort((x, y) => y.updated - x.updated)
    .map((e) => ({ animeId: e.id, title: e.title }))].filter((e) => e.title && !(store.getRating(e.animeId) && store.getRating(e.animeId) <= 4))
    .filter((e, i, all) => all.findIndex((x) => String(x.animeId) === String(e.animeId)) === i).slice(0, 3);
  // One request for all of them (the server mixes the lists); ids sorted so the answer caches well.
  if (recentShows.length) api(`/picks?ids=${recentShows.map((r) => r.animeId).sort().join(',')}`).then(({ results }) => {
    if (!alive()) return;
    const mine = new Set([...store.startedIds(), ...Object.keys(store.getList())].map(String));
    const mixed = (results || []).filter((rec) => !mine.has(String(rec.id)));
    if (!mixed.length) return;
    const title = recentShows.length > 1 ? 'Picked for you' : `Because you watched ${esc(recentShows[0].title)}`;
    document.getElementById('picked').innerHTML = shelf('shelf-picked', title, recentShows.length > 1 ? `from ${recentShows.map((r) => esc(r.title)).join(', ')}` : 'picked from what you watched');
    bindShelf('shelf-picked', async () => {
      const list = unstarted(mixed).slice(0, 16);
      // Recommendations carry one title only; look the full ones up (six at a time, cached) so
      // the cards follow the English/Japanese titles setting like the rest of the page.
      if (!IS_CINEMEE) {
        for (let i = 0; i < list.length; i += 6) {
          api(`/batch?ids=${list.slice(i, i + 6).map((r) => r.id).join(',')}`).then(({ results }) => {
            if (!alive()) return;
            for (const full of results || []) {
              cardShows.set(String(full.id), full);
              document.querySelectorAll(`#shelf-picked [data-card="${full.id}"] .card-title`).forEach((el) => { el.textContent = T(full); });
            }
          }).catch(() => {});
        }
      }
      return shelfCards(list);
    }, alive);
  }).catch(() => {});

  Promise.resolve(d.genres ? { genres: d.genres } : api('/genres')).then(({ genres }) => {
    if (!alive()) return;
    document.getElementById('home-genres').innerHTML = `<div class="section-head"><h2>Browse by genre</h2><a href="/search">All filters ›</a></div>
      <div class="chips">${genres.map((g) => `<a class="chip" href="/search?genres=${encodeURIComponent(g)}&order=score">${esc(g)}</a>`).join('')}</div>`;
  }).catch(() => {});
}

// The other site on the home page: what you're watching there (one account signs you in on every site), otherwise a
// small card about it that can be closed (it comes back after 60 days).
export const SIBLING_CACHE = 'animee-space:sibling-continue';
export const PROMO_KEY = 'animee-space:sibling-promo-closed';
export async function siblingContinue() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(SIBLING_CACHE) || 'null');
    if (hit && hit.at > Date.now() - 5 * 60e3) return hit.data;
  } catch { /* ignore */ }
  const r = await fetch(`${SIBLING.origin}/api/me/continue`, { credentials: 'include' });
  const data = r.ok ? await r.json() : { items: [] };
  try { sessionStorage.setItem(SIBLING_CACHE, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}
export function loadSibling(alive) {
  siblingContinue().catch(() => ({ items: [] })).then((d) => {
    if (!alive()) return;
    const items = d?.items || [];
    if (items.length) {
      const slot = document.getElementById('sibling-cont');
      if (!slot) return;
      slot.innerHTML = section(`Continue on ${SIBLING.name}`, '<div class="row">' + items.map((p) => {
        const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
        return `<a class="cont sibling" href="${esc(SIBLING.origin)}/watch/${esc(p.id)}?ep=${p.ep}">
          <img src="${esc(p.cover)}" alt="${esc(p.title)} poster" loading="lazy">
          <div style="min-width:0;flex:1">
            <div class="c-title">${esc(p.title)}</div>
            <div class="c-meta">${esc(p.label)} · on ${SIBLING.name} ↗</div>
            <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
          </div>
        </a>`;
      }).join('') + '</div>');
      return;
    }
    let closed = 0;
    try { closed = Number(localStorage.getItem(PROMO_KEY)) || 0; } catch { /* ignore */ }
    if (closed > Date.now() - 60 * 86400e3) return;
    const slot = document.getElementById('sibling-promo');
    if (!slot) return;
    slot.innerHTML = `<section class="section"><div class="sibling-promo">
      <div><b>Also by us: <span class="sib-name">${SIBLING.name}</span></b><p>${esc(SIBLING.pitch)} Free, and your account works there too.</p></div>
      <div class="actions"><a class="btn primary" href="${esc(SIBLING.origin)}/">Open ${SIBLING.name} ↗</a><button class="link-btn" type="button" data-close>Not now</button></div>
    </div></section>`;
    slot.querySelector('[data-close]').onclick = () => {
      try { localStorage.setItem(PROMO_KEY, String(Date.now())); } catch { /* ignore */ }
      slot.innerHTML = '';
    };
  });
}

// For shows where the last opened episode is finished, check whether the next one is out.
export function checkNewEpisodes(cont, alive) {
  // Only shows whose episode is (nearly) finished: it gets a tick as soon as it starts playing.
  const due = cont.filter((p) => p.duration && p.time / p.duration >= 0.85).slice(0, 8);
  if (!due.length) return;
  // One request for all of them.
  api(`/next-out?items=${due.map((p) => `${p.animeId}:${p.ep + 1}`).join(',')}`).then(({ out }) => {
    if (!alive()) return;
    for (const p of due) {
      const next = p.ep + 1;
      if (!out?.[`${p.animeId}:${next}`]) continue;
      const cardEl = app.querySelector(`.cont[href^="/watch/${p.animeId}?"]`);
      if (!cardEl) continue;
      cardEl.href = `/watch/${p.animeId}?ep=${next}`;
      const badge = cardEl.querySelector('.new-ep');
      badge.textContent = `Episode ${next} is out`;
      badge.hidden = false;
    }
  }).catch(() => {});
}

// Wide spotlight art, fetched by the browser. Kitsu has the sharpest wide art (its original files
// run up to 3072px wide at about 3:1, close to the spotlight's shape); AniList's 1900x400 banners
// fill the gaps. Both allow browser requests. Answers, including "no art", are kept for three
// days. Any failure just leaves the cover art.
export const ART_KEY = 'animee-space:art';
export const ART_TTL = 3 * 86400e3;
export const KITSU = 'https://kitsu.app/api/edge/mappings?filter[externalSite]=myanimelist/anime&include=item&fields[anime]=coverImage&page[limit]=20&filter[externalId]=';
// Kitsu's original upload when it's a JPEG (a few hundred KB, true aspect); its PNG originals can
// be several MB, so those use the 3360x800 JPEG copy instead.
export function kitsuArt(cover) {
  if (!cover) return null;
  if (typeof cover.original === 'string' && /\.jpe?g(\?|$)/i.test(cover.original)) return cover.original;
  return typeof cover.large === 'string' ? cover.large : null;
}
export async function fromKitsu(ids) {
  const r = await fetch(KITSU + ids.join(','), { headers: { Accept: 'application/vnd.api+json' } });
  if (!r.ok) return {};
  const d = await r.json();
  const art = new Map((d.included || []).map((item) => [item.id, kitsuArt(item.attributes?.coverImage)]));
  const found = {};
  for (const m of d.data || []) {
    const url = art.get(m.relationships?.item?.data?.id);
    if (url && url.startsWith('https://')) found[m.attributes?.externalId] = url;
  }
  return found;
}
export async function fromAniList(ids) {
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: 'query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal bannerImage } } }', variables: { ids: ids.map(Number) } }),
  });
  if (!r.ok) return {};
  const d = await r.json();
  const found = {};
  for (const m of d?.data?.Page?.media || []) {
    if (typeof m?.bannerImage === 'string' && m.bannerImage.startsWith('https://') && !found[m.idMal]) found[m.idMal] = m.bannerImage;
  }
  return found;
}
export async function loadBanners(ids) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(ART_KEY) || '{}') || {}; } catch { saved = {}; }
  const now = Date.now();
  const missing = ids.filter((id) => /^\d+$/.test(id) && !(saved[id] && saved[id].t > now - ART_TTL));
  if (missing.length) {
    const kitsu = await fromKitsu(missing).catch(() => null);
    const rest = missing.filter((id) => !kitsu?.[id]);
    const anilist = rest.length ? await fromAniList(rest).catch(() => null) : {};
    if (kitsu || anilist) for (const id of missing) saved[id] = { u: kitsu?.[id] || anilist?.[id] || null, t: now };
    for (const [id, v] of Object.entries(saved)) if (!v || v.t < now - ART_TTL) delete saved[id];
    try { localStorage.setItem(ART_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked */ }
  }
  return Object.fromEntries(ids.map((id) => [id, saved[id]?.u || null]));
}
// Phones show the sharp portrait cover instead: it fits a tall frame without cropping.
export const wideScreen = () => matchMedia('(min-width: 761px)').matches;
// Art loads one slide at a time (the current one and the next), not all eight at once.
export function loadSlideArt(slide) {
  const url = slide?.dataset.art;
  if (!url || slide.querySelector('.slide-art') || !wideScreen()) return;
  const img = new Image();
  img.className = 'slide-art';
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => slide.classList.add('has-art');
  img.src = url;
  slide.prepend(img);
}

export function bindSpotlight(alive) {
  const root = app.querySelector('.spotlight');
  if (!root) return;
  const slides = [...root.querySelectorAll('.slide')];
  const dots = [...root.querySelectorAll('.dots button')];
  let i = 0;
  const warm = () => { loadSlideArt(slides[i]); loadSlideArt(slides[(i + 1) % slides.length]); };
  // cinemee's wide art comes straight from TMDB (data-art); the Kitsu/AniList lookup is anime-only.
  (IS_CINEMEE ? Promise.resolve({}) : loadBanners(slides.map((s) => s.dataset.id))).then((urls) => {
    if (!alive()) return;
    slides.forEach((s) => { if (urls[s.dataset.id]) s.dataset.art = urls[s.dataset.id]; });
    warm();
  });
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    dots.forEach((d, k) => { d.classList.toggle('on', k === i); d.setAttribute('aria-current', k === i); });
    warm();
  };
  dots.forEach((d, k) => d.onclick = () => { show(k); restart(); });
  let timer = null;
  const restart = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 7000); };
  restart();
  root.onmouseenter = () => clearInterval(timer);
  root.onmouseleave = restart;
  // Keyboard / TV remote: no rotating away under a focused button.
  root.addEventListener('focusin', () => clearInterval(timer));
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) restart(); });
  // ← on the first button / → on the last one change the slide (the remote has no other way to).
  root.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const buttons = [...slides[i].querySelectorAll('.actions a')];
    const at = buttons.indexOf(e.target);
    if (at < 0) return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    if ((step > 0 && at !== buttons.length - 1) || (step < 0 && at !== 0)) return;
    e.preventDefault();
    show(i + step);
    const next = [...slides[i].querySelectorAll('.actions a')];
    (step > 0 ? next[0] : next[next.length - 1])?.focus({ preventScroll: true });
  });
  onCleanup(() => clearInterval(timer));
}

// Spotlight art: the cover as a blurred backdrop with the sharp poster beside it, until the
// show's wide art arrives (see loadBanners) and fades in over the top.
export function spotlight(list) {
  if (!list?.length) return '';
  return `<section class="spotlight" aria-label="Spotlight">
    ${list.map((a, i) => `
      <div class="slide${i === 0 ? ' on' : ''}" data-id="${a.id}"${IS_CINEMEE && a.banner ? ` data-art="${esc(a.banner)}"` : ''}>
        <div class="slide-bg" style="background-image:url('${esc(a.cover)}')"></div>
        <img class="slide-poster" src="${esc(a.cover)}" alt="" ${i ? 'loading="lazy"' : ''}>
        <div class="slide-info">
          <div class="rank"><span>#${i + 1}</span> spotlight</div>
          <h2>${esc(T(a))}</h2>
          <div class="meta">
            ${a.format ? `<span>${FORMAT[a.format]}</span>` : ''}
            ${a.score ? `<span>★ ${score(a.score)}</span>` : ''}
            ${a.year ? `<span>${a.year}</span>` : ''}
            ${!IS_CINEMEE && epsLabel(a) !== '?' ? `<span>${epsLabel(a)} eps</span>` : ''}
            ${a.genres.slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join('')}
          </div>
          <p>${esc(a.description)}</p>
          <div class="actions">
            <a class="btn primary" href="/watch/${a.id}">▶ ${WORDS.Watch} now</a>
            <a class="btn" href="${animeHref(a)}">Details ›</a>
          </div>
        </div>
      </div>`).join('')}
    <div class="dots">${list.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>
  </section>`;
}

export function contCard(p) {
  const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
  return `<a class="cont" href="/watch/${p.animeId}?ep=${p.ep}">
    <img src="${esc(p.cover)}" alt="${esc(p.title)} poster" loading="lazy">
    <div style="min-width:0;flex:1">
      <div class="c-title">${esc(p.title)}</div>
      <div class="c-meta">${isMovie(p) ? 'Movie' : IS_MANGEE ? `Page ${(p.time || 0) + 1}${p.duration ? ` of ${p.duration}` : ''}` : `Episode ${p.ep}`}</div>
      <span class="new-ep" hidden></span>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>
    <button class="x" data-id="${p.animeId}" aria-label="Remove">✕</button>
  </a>`;
}

export function top10(list) {
  return `<div class="top10">${(list || []).map((a, i) => `
    <a href="${animeHref(a)}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <img src="${esc(a.cover)}" alt="${esc(T(a))} poster" loading="lazy">
      <div><div class="t">${esc(T(a))}</div><div class="m">${[FORMAT[a.format], a.score ? `★ ${score(a.score)}` : ''].filter(Boolean).join(' · ')}</div></div>
    </a>`).join('')}</div>`;
}

// ---------- search / browse ----------
export function selectField(name, label, options, value, anyLabel) {
  return `<label class="field"><span>${label}</span><select name="${name}">
    <option value="">${anyLabel}</option>
    ${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
  </select></label>`;
}

export async function viewSearch(q, alive) {
  // Older links used ?genre=; treat it like ?genres=.
  if (q.get('genre') && !q.get('genres')) { q.set('genres', q.get('genre')); q.delete('genre'); }
  const picked = (q.get('genres') || '').split(',').filter(Boolean);
  const { genres } = await api('/genres').catch(() => ({ genres: [] }));
  if (!alive()) return;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear + 2 - 1970 }, (_, i) => String(thisYear + 1 - i)).map((y) => [y, y]);
  const typeLabel = TYPE_OPTIONS.find(([v]) => v === q.get('type'))?.[1];
  const statusLabel = STATUS_OPTIONS.find(([v]) => v === q.get('status'))?.[1];
  const heading = q.get('studioName') ? `${q.get('studioName')} anime` : q.get('q') ? 'Search results' : typeLabel ? `${typeLabel}${typeLabel.endsWith('s') ? '' : 's'}` : statusLabel || (IS_CINEMEE ? 'Browse movies and TV' : 'Browse anime');

  app.innerHTML = `
    <h1 class="page-title">${esc(heading)}</h1>
    <form class="filters" id="filters">
      ${q.get('studio') ? `<input type="hidden" name="studio" value="${esc(q.get('studio'))}"><input type="hidden" name="studioName" value="${esc(q.get('studioName') || '')}">` : ''}
      <div class="filter-row">
        <input class="input q" name="q" placeholder="Search titles…" value="${esc(q.get('q') || '')}" aria-label="Search titles">
        <button class="btn primary" type="submit">Search</button>
      </div>
      <nav class="chips type-chips" aria-label="Type">
        <a class="chip${!q.get('type') ? ' on' : ''}" href="/search">All</a>
        ${TYPE_OPTIONS.slice(0, IS_CINEMEE ? 2 : 5).map(([v, l]) => `<a class="chip${q.get('type') === v ? ' on' : ''}" href="/search?type=${v}">${esc(l)}${l.endsWith('s') ? '' : 's'}</a>`).join('')}
      </nav>
      <details class="more-filters"${[...q.keys()].some((k) => !['q', 'page', 'type'].includes(k)) ? ' open' : ''}>
      <summary class="btn sm">⚙ Filters</summary>
      <div class="filter-grid">
        ${selectField('type', 'Type', TYPE_OPTIONS, q.get('type') || '', 'Any type')}
        ${selectField('status', 'Status', STATUS_OPTIONS, q.get('status') || '', 'Any status')}
        ${IS_CINEMEE ? '' : selectField('season', 'Season', SEASON_OPTIONS, q.get('season') || '', 'Any season')}
        ${selectField('year', 'Year', years, q.get('year') || '', 'Any year')}
        ${selectField('score', 'Score', [9, 8, 7, 6, 5].map((s) => [String(s), `${s} and up`]), q.get('score') || '', 'Any score')}
        ${IS_CINEMEE ? '' : selectField('rating', 'Age rating', RATING_OPTIONS, q.get('rating') || '', 'Any rating')}
        ${selectField('order', 'Sort by', ORDER_OPTIONS, q.get('order') || '', q.get('q') ? 'Best match' : 'Most popular')}
      </div>
      <details class="genre-picker"${picked.length ? ' open' : ''}>
        <summary>Genres <small class="card-meta">${picked.length ? esc(picked.join(', ')) : `pick up to ${MAX_GENRES}`}</small></summary>
        <div class="chips">${genres.map((g) => `<label class="chip check"><input type="checkbox" name="genres" value="${esc(g)}"${picked.includes(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('')}</div>
      </details>
      </details>
      ${[...q.keys()].some((k) => k !== 'page') ? '<a class="link-btn" href="/search">Clear all filters</a>' : ''}
    </form>
    <div id="results">${loader()}</div>`;

  const form = document.getElementById('filters');
  const submit = () => {
    const params = new URLSearchParams();
    const chosen = [];
    for (const [key, value] of new FormData(form)) {
      const v = String(value).trim();
      if (!v) continue;
      if (key === 'genres') chosen.push(v); else params.set(key, v);
    }
    if (chosen.length) params.set('genres', chosen.join(','));
    go('/search' + (params.toString() ? '?' + params.toString() : ''));
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  form.querySelectorAll('select').forEach((s) => s.onchange = submit);
  form.querySelectorAll('input[name=genres]').forEach((box) => box.onchange = () => {
    if (form.querySelectorAll('input[name=genres]:checked').length > MAX_GENRES) { box.checked = false; return; }
    submit();
  });

  const params = new URLSearchParams(q);
  const d = await api('/search?' + params.toString());
  if (!alive()) return;
  const note = d.approximate ? `<p class="card-meta">No exact match for “${esc(q.get('q'))}”. Showing close matches.</p>`
    : d.seasonal ? '<p class="card-meta">Showing the most popular titles from that period.</p>' : '';
  const info = d.pageInfo || { currentPage: 1, hasNextPage: false };
  const page = info.currentPage || 1;
  const pageLink = n => {
    const p = new URLSearchParams(q);
    p.set('page', String(n));
    return '/search?' + p.toString();
  };
  const pager = (info.hasNextPage || page > 1) ? `
    <div class="pager">
      ${page > 1 ? '<a class="btn sm" href="' + pageLink(page - 1) + '">‹ Previous</a>' : ''}
      <span>Page ${page}${info.lastPage ? ' of ' + info.lastPage : ''}</span>
      ${info.hasNextPage ? '<a class="btn sm" href="' + pageLink(page + 1) + '">Next ›</a>' : ''}
    </div>` : '';
  // Hidden genres stay out of browsing (not out of a title search, and not when that genre is picked).
  const pickedGenres = (q.get('genres') || '').split(',').filter(Boolean);
  const results = q.get('q') ? d.results || [] : withoutHiddenGenres(d.results || [], pickedGenres);
  const count = info.total ? `<p class="card-meta result-count">${Number(info.total).toLocaleString()} title${info.total === 1 ? '' : 's'}</p>` : '';
  document.getElementById('results').innerHTML = count + note +
    '<div id="genre-top"></div>' +
    '<div class="section">' + (results.length ? grid(results) : `<div class="empty"><h2>No matches found</h2><p>Try a different title or fewer filters.</p>${q.get('q') ? `<p>Looking for ${SIBLING.what}? <a href="${esc(SIBLING.origin)}/search?q=${encodeURIComponent(q.get('q'))}">Search “${esc(q.get('q'))}” on ${SIBLING.name} ↗</a></p>` : ''}</div>`) + '</div>' + pager;
  // One genre and nothing else picked: the genre's Top 10 by score above the results.
  const onlyGenre = pickedGenres.length === 1 && page === 1 && ![...q.keys()].some((k) => !['genres', 'genre'].includes(k));
  if (onlyGenre) {
    api(`/search?genres=${encodeURIComponent(pickedGenres[0])}&order=score`).then((top) => {
      const box = document.getElementById('genre-top');
      if (!box || !alive() || !top.results?.length) return;
      box.innerHTML = `<section class="section"><div class="section-head"><h2>Top 10 ${esc(pickedGenres[0].toLowerCase())}</h2></div>${top10(top.results.slice(0, 10))}</section>`;
    }).catch(() => {});
  }
}

// ---------- ranked lists ----------
export async function viewList(name, alive) {
  if (!LIST_TITLES[name]) return viewNotFound();
  const d = await api(`/list/${name}?limit=25`);
  if (!alive()) return;
  document.title = `${LIST_TITLES[name]} · ${BRAND.title}`;
  const others = Object.keys(LIST_TITLES).filter((k) => k !== name);
  app.innerHTML = `<h1 class="page-title">${LIST_TITLES[name]}</h1>
    <div class="tabs">${[name, ...others].map((k) => `<a class="tab${k === name ? ' on' : ''}" href="/top/${k}">${LIST_TITLES[k]}</a>`).join('')}</div>
    ${top10(d.results)}`;
}

// ---------- random ----------
export async function viewRandom(alive) {
  const { id } = await api('/random', { fresh: true });
  if (alive()) go(`/anime/${id}?from=random`, { replace: true });
}

// ---------- anime details ----------
export function bindShare(a) {
  const btn = document.getElementById('share');
  if (!btn) return;
  btn.onclick = async () => {
    const url = `${location.origin}${animeHref(a)}`;
    if (navigator.share) return navigator.share({ title: a.title, url }).catch(() => {});
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied'; } catch { prompt('Copy this link', url); }
  };
}

// The whole franchise in watching order, with the current title marked.
export function loadSeasons(a, alive, slotId, linkTo = 'anime', onLoaded) {
  api(`/anime/${a.id}/seasons`).then(({ seasons }) => {
    const slot = document.getElementById(slotId);
    if (!alive() || !slot || seasons.length < 2) return;
    // cinemee TV: the show's own seasons, each opening its first episode (title page only; the
    // watch page already picks episodes season by season).
    if (seasons[0].season) {
      if (linkTo !== 'anime') return;
      slot.innerHTML = `<section class="section seasons">
        <div class="section-head"><h2>Seasons</h2></div>
        <p class="card-meta">${plural(seasons.length, 'season')}</p>
        <div class="season-row">${seasons.map((s) => {
          const inner = `<img src="${esc(s.cover)}" alt="${esc(s.title)} poster" loading="lazy">
            <span class="season-info">
              <small>${[s.year, s.episodes ? plural(s.episodes, 'episode') : ''].filter(Boolean).join(' · ')}</small>
              <b>${esc(s.title)}</b>
              ${s.startEp ? '' : `<span class="here-badge">${s.airDate ? `Starts ${new Date(s.airDate + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Coming later'}</span>`}
            </span>`;
          return s.startEp ? `<a class="season" href="/watch/${a.id}?season=${s.season}">${inner}</a>` : `<div class="season">${inner}</div>`;
        }).join('')}</div>
      </section>`;
      return;
    }
    slot.innerHTML = `<section class="section seasons">
      <div class="section-head"><h2>${IS_CINEMEE ? 'In this collection' : 'Seasons and movies'}</h2></div>
      <p class="card-meta">${seasons.length} parts in watching order</p>
      <div class="season-row">${seasons.map((s, i) => {
        const here = s.id === String(a.id);
        return `<a class="season${here ? ' here' : ''}" href="/${linkTo}/${s.id}"${here ? ' aria-current="page"' : ''}>
          <img src="${esc(s.cover)}" alt="${esc(T(s))} poster" loading="lazy">
          <span class="season-info">
            <small>${i + 1}. ${[FORMAT[s.format] || s.format, s.year].filter(Boolean).join(', ')}</small>
            <b>${esc(T(s))}</b>
            ${here ? '<span class="here-badge">You are here</span>' : ''}
          </span>
        </a>`;
      }).join('')}</div>
    </section>`;
    // Centre the current part by scrolling the strip only, never the page.
    const row = slot.querySelector('.season-row');
    const here = slot.querySelector('.season.here');
    if (row && here) row.scrollLeft = here.offsetLeft - row.offsetLeft - (row.clientWidth - here.offsetWidth) / 2;
    onLoaded?.(new Set(seasons.map((s) => s.id)));
  }).catch(() => {});
}

// Characters and recommendations come from a separate request so the page shows sooner.
export function loadExtras(id, alive, slots) {
  api(`/anime/${id}/extras`).then((x) => {
    if (!alive()) return;
    const chars = slots.chars && document.getElementById(slots.chars);
    if (chars && x.characters?.length) chars.innerHTML = section(IS_CINEMEE ? 'Cast' : 'Characters & voice actors', `<div class="chars">${x.characters.map((c) => `
      <div class="char">
        <div><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"><span>${esc(c.name)}<small>${esc(c.role)}</small></span></div>
        ${c.va ? `<div><img src="${esc(c.va.image)}" alt="${esc(c.va.name)}" loading="lazy"><span>${esc(c.va.name)}<small>Japanese</small></span></div>` : ''}
      </div>`).join('')}</div>`);
    const recs = slots.recs && document.getElementById(slots.recs);
    // cinemee: IMDb / Rotten Tomatoes / Metacritic scores at the top of the info box.
    const box = slots.ratings && document.getElementById(slots.ratings);
    const r = x.ratings;
    if (box && r?.imdbUrl) {
      const parts = [
        `<a href="${esc(r.imdbUrl)}" target="_blank" rel="noopener">IMDb${r.imdb ? ` <b class="rate">${r.imdb.score.toFixed(1)}</b>` : ''}</a>${r.imdb?.votes ? ` <small>(${r.imdb.votes.toLocaleString()})</small>` : ''}`,
        r.rottenTomatoes ? `Rotten Tomatoes <b class="rate">${esc(r.rottenTomatoes)}</b>` : '',
        r.metacritic ? `Metacritic <b class="rate">${r.metacritic}</b>` : '',
      ].filter(Boolean);
      box.insertAdjacentHTML('afterbegin', `<div class="ratings"><b>Ratings</b><span>${parts.join(' · ')}</span></div>`);
    }
    if (recs && x.recommendations?.length && !IS_CINEMEE) {
      // Look the full titles up (six at a time, cached) and rename the cards in place.
      const ids = x.recommendations.slice(0, slots.limit || 12).map((r) => r.id);
      for (let i = 0; i < ids.length; i += 6) {
        api(`/batch?ids=${ids.slice(i, i + 6).join(',')}`).then(({ results }) => {
          if (!alive()) return;
          for (const full of results || []) {
            cardShows.set(String(full.id), full);
            recs.querySelectorAll(`[data-card="${full.id}"] .card-title`).forEach((el) => { el.textContent = T(full); });
          }
        }).catch(() => {});
      }
    }
    if (recs && x.recommendations?.length) recs.innerHTML = section('You might also like', grid(store.notInterestedIds().size ? x.recommendations.filter((r) => !store.notInterestedIds().has(String(r.id))).slice(0, slots.limit || 12) : x.recommendations.slice(0, slots.limit || 12)));
  }).catch(() => {});
}

export function listSelect(a) {
  const entry = store.getEntry(a.id);
  return `<select id="list-status" aria-label="Watchlist">
    <option value="">${entry?.status ? 'Remove from list' : '＋ Add to list'}</option>
    ${store.LIST_STATUSES.filter(([k]) => k !== 'notinterested' || entry?.status === k).map(([k, l]) => `<option value="${k}"${entry?.status === k ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
}
export function bindListSelect(a) {
  const sel = document.getElementById('list-status');
  if (!sel) return;
  sel.onchange = () => {
    store.setEntry(a, sel.value || null);
    sel.outerHTML = listSelect(a);
    bindListSelect(a);
    refreshListButtons(a);
  };
}

// 🔔 Follow: airing and upcoming shows only.
export const canFollow = (a) => a.status === 'RELEASING' || a.status === 'NOT_YET_RELEASED';
export function followButton(a, small = false) {
  if (!canFollow(a)) return '';
  const on = store.isFollowing(a.id);
  const upcoming = a.status === 'NOT_YET_RELEASED';
  const label = upcoming ? (on ? '🔔 Reminder on' : '🔕 Remind me when it starts') : on ? '🔔 Following' : '🔕 Follow';
  return `<button class="btn${small ? ' sm' : ''}${on ? ' active' : ''}" id="follow-btn" type="button" aria-pressed="${on}"
    title="${upcoming ? 'Get told when episode 1 is out' : 'Get new episodes in Notifications'}${'Notification' in window ? ' (and as pop-ups)' : ''}">${label}</button>`;
}
export function bindFollow(a, small = false) {
  const b = document.getElementById('follow-btn');
  if (!b) return;
  b.onclick = () => {
    const on = !store.isFollowing(a.id);
    store.setFollow(a, on, a.availableEpisodes || 0);
    b.outerHTML = followButton(a, small);
    bindFollow(a, small);
    if (on) toastNote(push.supported() && push.permission() !== 'granted'
      ? 'Following. New episodes show up in <a href="/new">Notifications</a>. <a href="/settings#alerts">Turn on pop-ups</a> to get them even when animee is closed.'
      : 'Following. New episodes show up in <a href="/new">Notifications</a>.');
  };
}
// Broken artwork (a poster or cover that fails to load) becomes a quiet placeholder.
export const ART_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 225 318"><rect width="225" height="318" fill="#121417"/><path d="M78 168 L92 144 L106 168 M120 168 L134 144 L148 168" fill="none" stroke="#5B6169" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>');
window.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.fallback || img.classList.contains('slide-art')) return;
  img.dataset.fallback = '1';
  img.src = ART_PLACEHOLDER;
}, true);

// Page crashes are counted (view + first line of the message, nothing else) for the admin page.
// At most three per page load, and only errors from this site's own scripts.
export let errorsSent = 0;
export function sendError(message, source = '') {
  if (errorsSent >= 3 || !message || /^Script error\.?$/i.test(String(message))) return;
  if (!source || !String(source).startsWith(location.origin)) return; // only this site's own scripts
  errorsSent++;
  const place = parseHash().parts[0] || 'home';
  fetch('/api/error', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ place, message: String(message).slice(0, 300) }) }).catch(() => {});
}
window.addEventListener('error', (e) => { if (e instanceof ErrorEvent) sendError(e.message, e.filename); });
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  // Network hiccups and aborted requests aren't crashes.
  if (r?.name === 'AbortError' || /fetch|network|load failed/i.test(String(r?.message || r))) return;
  sendError(r?.message || String(r), r?.stack?.match(/https?:\/\/[^\s)]+?\.js/)?.[0] || '');
});

// Hover a poster for a moment (mouse only, wide screens): a preview card with the trailer
// playing muted, the story and Watch / Details buttons. It closes when the mouse leaves both.
// Not on TVs: LG's pointer remote would trigger it, and a trailer per card is heavy there.
export const canPreview = () => !isTv() && matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)').matches;
export let previewTimer = 0;
export let previewClose = 0;
export let previewFor = '';
export function closePreview() {
  clearTimeout(previewTimer);
  document.getElementById('hover-card')?.remove();
  previewFor = '';
}
export function placePreview(el, cardEl) {
  const r = cardEl.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const right = r.right + 12 + w <= innerWidth - 8;
  const left = right ? r.right + 12 : Math.max(8, r.left - 12 - w);
  const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), innerHeight - h - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
export async function openPreview(cardEl) {
  const id = cardEl.dataset.card;
  if (!id || previewFor === id || !document.contains(cardEl)) return;
  closePreview();
  previewFor = id;
  let a = cardShows.get(id);
  try { a = { ...a, ...(await api(`/anime/${id}`)) }; } catch { /* use what the card knows */ }
  if (previewFor !== id || !a?.title || !cardEl.matches(':hover')) { if (previewFor === id) previewFor = ''; return; }
  const el = document.createElement('div');
  el.id = 'hover-card';
  el.className = 'hover-card';
  el.innerHTML = `${a.trailer
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(a.trailer)}?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&playlist=${esc(a.trailer)}&modestbranding=1&rel=0" title="${esc(T(a))} trailer" allow="autoplay; encrypted-media"></iframe>`
    : `<img src="${esc(a.banner || a.cover)}" alt="">`}
    <div class="hc-body">
      <b>${esc(T(a))}</b>
      <div class="card-meta">${[FORMAT[a.format], a.year, a.score ? `★ ${score(a.score)}` : '', !isMovie(a) && a.availableEpisodes ? `${a.availableEpisodes} eps` : '', a.rating].filter(Boolean).map(esc).join(' · ')}</div>
      ${a.genres?.length ? `<div class="hc-genres">${a.genres.slice(0, 4).map(esc).join(' · ')}</div>` : ''}
      <p>${esc(a.description || '')}</p>
      <div class="actions">${a.availableEpisodes ? `<a class="btn primary sm" href="/watch/${esc(a.id)}">▶ Watch</a>` : ''}<a class="btn sm" href="${animeHref(a)}">Details</a></div>
    </div>`;
  document.body.appendChild(el);
  placePreview(el, cardEl);
  el.onmouseenter = () => clearTimeout(previewClose);
  el.onmouseleave = () => { previewClose = setTimeout(closePreview, 200); };
}
document.addEventListener('mouseover', (e) => {
  const cardEl = e.target.closest?.('a.card[data-card]');
  if (!cardEl || !canPreview()) return;
  clearTimeout(previewClose);
  if (previewFor === cardEl.dataset.card) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => openPreview(cardEl), 700);
});
document.addEventListener('mouseout', (e) => {
  const cardEl = e.target.closest?.('a.card[data-card]');
  if (!cardEl || cardEl.contains(e.relatedTarget)) return;
  clearTimeout(previewTimer);
  if (previewFor) previewClose = setTimeout(closePreview, 200);
});
window.addEventListener('scroll', closePreview, { passive: true });
window.addEventListener('animee:navigate', closePreview);

// A toast with an Undo button.
export function undoToast(text, undo) {
  toastNote(`${esc(text)} <button class="link-btn" type="button" data-undo>Undo</button>`);
  const b = document.querySelector('.toast [data-undo]');
  if (b) b.onclick = () => { undo(); document.querySelector('.toast')?.remove(); };
}

// The poster save menu: list status, favourite, not interested.
export function openSaveMenu(button, a) {
  closeSaveMenu();
  const entry = store.getEntry(a.id) || {};
  const menu = document.createElement('div');
  menu.className = 'save-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `<b>${esc(T(a))}</b>
    ${store.LIST_STATUSES.filter(([k]) => k !== 'notinterested').map(([k, l]) => `<button type="button" data-status="${k}"${entry.status === k ? ' class="on"' : ''}>${entry.status === k ? '✓ ' : ''}${l}</button>`).join('')}
    <button type="button" data-fav>${entry.favourite ? '♥ Favourite' : '♡ Favourite'}</button>
    <button type="button" data-ni>Not interested</button>
    ${entry.status ? '<button type="button" data-status="">Remove from list</button>' : ''}
    <label class="save-rate">Your rating ${ratingSelect(a, 'menu-rating')}</label>`;
  document.body.appendChild(menu);
  bindRatingSelect(a, menu.querySelector('#menu-rating'));
  menu.querySelector('.save-rate').addEventListener('click', (ev) => ev.stopPropagation());
  const r = button.getBoundingClientRect();
  menu.style.top = `${Math.min(window.scrollY + r.bottom + 6, window.scrollY + innerHeight - menu.offsetHeight - 10)}px`;
  menu.style.left = `${Math.max(10, Math.min(window.scrollX + r.left, window.scrollX + innerWidth - menu.offsetWidth - 10))}px`;
  const refresh = () => {
    const e2 = store.getEntry(a.id);
    button.classList.toggle('on', Boolean(e2?.status || e2?.favourite));
    button.textContent = e2?.status || e2?.favourite ? '✓' : '＋';
  };
  menu.onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if ('status' in b.dataset) store.setEntry(a, b.dataset.status || null);
    if ('fav' in b.dataset) store.setFavourite(a, !store.getEntry(a.id)?.favourite);
    if ('ni' in b.dataset) {
      const before = store.getEntry(a.id)?.status || null;
      store.setEntry(a, 'notinterested');
      const cardEl = button.closest('.card');
      if (cardEl) cardEl.hidden = true;
      undoToast('Hidden from rows and picks.', () => { store.setEntry(a, before); if (cardEl) cardEl.hidden = false; refresh(); });
    }
    refresh();
    closeSaveMenu();
  };
  setTimeout(() => document.addEventListener('click', closeSaveMenu, { once: true }), 0);
}
export function closeSaveMenu() { document.querySelector('.save-menu')?.remove(); }
// Bells on schedule rows: follow or unfollow without opening the show.
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-follow]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const a = cardShows.get(b.dataset.follow);
  if (!a) return;
  const on = !store.isFollowing(a.id);
  store.setFollow(a, on, a.availableEpisodes || 0);
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '🔔' : '🔕';
  toastNote(on ? `Following ${esc(T(a))}. New episodes show up in <a href="/new">Notifications</a>.` : `Stopped following ${esc(T(a))}.`);
}, true);
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('[data-save]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const a = cardShows.get(b.dataset.save);
  if (a) openSaveMenu(b, a);
}, true);
window.addEventListener('animee:navigate', closeSaveMenu);

// A small message at the bottom of the screen that fades after a few seconds.
export function toastNote(html) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 6000);
  setTimeout(() => el.remove(), 6600);
}

// Favourite and Not interested buttons on the detail page.
export function listButtons(a) {
  const entry = store.getEntry(a.id);
  const fav = !!entry?.favourite;
  const ni = entry?.status === 'notinterested';
  return `<span class="list-buttons" id="list-buttons">
    <button class="btn${fav ? ' active' : ''}" id="fav-btn" type="button" aria-pressed="${fav}">${fav ? '♥ Favourite' : '♡ Favourite'}</button>
    <button class="btn${ni ? ' active' : ''}" id="ni-btn" type="button" aria-pressed="${ni}" title="Hide from home rows, picks and recommendations">${ni ? '✕ Not interested' : 'Not interested'}</button>
  </span>`;
}
export function refreshListButtons(a) {
  const box = document.getElementById('list-buttons');
  if (!box) return;
  box.outerHTML = listButtons(a);
  bindListButtons(a);
}
// Your own 1-10 rating (title pages and the poster menu).
export const RATING_WORDS = ['', 'Appalling', 'Horrible', 'Very bad', 'Bad', 'Average', 'Fine', 'Good', 'Very good', 'Great', 'Masterpiece'];
export function ratingSelect(a, id = 'my-rating') {
  const r = store.getRating(a.id);
  return `<select id="${id}" class="rating-select${r ? ' rated' : ''}" aria-label="Your rating for ${esc(T(a))}">
    <option value="0">${r ? 'Remove my rating' : '★ Rate it'}</option>
    ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}"${r === n ? ' selected' : ''}>★ ${n} · ${RATING_WORDS[n]}</option>`).join('')}
  </select>`;
}
export function bindRatingSelect(a, el) {
  if (!el) return;
  el.onchange = () => {
    store.setRating(a, el.value);
    const r = store.getRating(a.id);
    el.classList.toggle('rated', Boolean(r));
    el.options[0].textContent = r ? 'Remove my rating' : '★ Rate it';
    toastNote(r ? `You rated ${esc(T(a))} <b>${r}/10</b>.` : 'Rating removed.');
  };
}
export function bindListButtons(a) {
  const fav = document.getElementById('fav-btn');
  const ni = document.getElementById('ni-btn');
  if (!fav || !ni) return;
  fav.onclick = () => {
    store.setFavourite(a, !store.getEntry(a.id)?.favourite);
    refreshListButtons(a);
  };
  ni.onclick = () => {
    const before = store.getEntry(a.id)?.status || null;
    const isNi = before === 'notinterested';
    store.setEntry(a, isNi ? null : 'notinterested');
    const redraw = () => {
      refreshListButtons(a);
      const sel = document.getElementById('list-status');
      if (sel) { sel.outerHTML = listSelect(a); bindListSelect(a); }
    };
    redraw();
    if (!isNi) undoToast('Hidden from rows and picks. Find it again in My list, Not interested.', () => { store.setEntry(a, before); redraw(); });
  };
}

export async function viewAnime(id, alive, query = new URLSearchParams()) {
  if (!id) return viewNotFound();
  const a = await api(`/anime/${id}`);
  if (!alive()) return;
  document.title = `${a.title} · ${BRAND.title}`;
  store.rememberMeta(a);
  // Old or slug-less links settle on the show's one canonical address.
  if (location.pathname !== animeHref(a)) history.replaceState(null, '', animeHref(a) + location.search);
  const prog = store.getProgress(a.id);
  // An airing show can be missing its episode count; it still has episodes to watch.
  // A manga is readable only when chapters are here (licensed series often have none on MangaDex).
  const canWatch = a.availableEpisodes > 0 || (!IS_MANGEE && a.status === 'RELEASING');

  app.innerHTML = `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${esc(a.banner || a.cover)}')"></div>
      <div class="hero-inner">
        <img class="cover" src="${esc(a.cover)}" alt="">
        <div>
          <h1>${esc(T(a))}</h1>
          <div class="alt">${esc([a.titleRomaji !== a.title ? a.titleRomaji : null, a.titleNative].filter(Boolean).join(' · '))}</div>
          <div class="chips">
            ${a.score ? `<span class="chip">★ ${score(a.score)}</span>` : ''}
            ${a.format ? `<span class="chip">${FORMAT[a.format]}</span>` : ''}
            <span class="chip">${STATUS[a.status] || a.status}</span>
            ${lengthLabel(a) ? `<span class="chip">${lengthLabel(a)}</span>` : ''}
            ${a.duration ? `<span class="chip">${a.duration} min</span>` : ''}
            ${canWatch && !IS_CINEMEE && !IS_MANGEE ? '<span class="chip avail" id="avail-chip" hidden></span>' : ''}
            ${[...a.genres, ...(a.themes || [])].map((g) => `<a class="chip" href="/search?genres=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
          </div>
          <div class="actions">
            ${canWatch
              ? `<a class="btn primary" href="/watch/${a.id}${prog ? `?ep=${prog.ep}` : ''}">▶ ${prog ? (isMovie(a) ? 'Resume' : IS_CINEMEE ? `Continue episode ${prog.ep}` : IS_MANGEE ? `Continue reading` : `Continue EP ${prog.ep}`) : `${WORDS.Watch} now`}</a>`
              : IS_MANGEE
                ? `<span class="btn" aria-disabled="true">No chapters here</span>${a.officialUrl ? `<a class="btn primary" href="${esc(a.officialUrl)}" target="_blank" rel="noopener">Read it officially ↗</a>` : ''}`
                : '<span class="btn" aria-disabled="true">Not released yet</span>'}
            ${listSelect(a)}
            ${followButton(a)}
            ${canWatch && !isMovie(a) && a.availableEpisodes > 1 ? `<a class="btn" href="/watch/${a.id}?ep=${a.availableEpisodes}">${IS_MANGEE ? 'Newest chapter' : `Newest: episode ${a.availableEpisodes}`}</a>` : ''}
            ${canWatch && prog && !isMovie(a) && prog.ep > 1 ? `<a class="btn" href="/watch/${a.id}?ep=1">From ${WORDS.ep} 1</a>` : ''}
            ${listButtons(a)}
            ${ratingSelect(a)}
            <button class="btn" id="share" type="button">Share</button>
            ${query.get('from') === 'random' ? '<a class="btn" href="/random">🎲 Another random</a>' : ''}
          </div>
          ${a.status === 'RELEASING' && nextBroadcast(a.broadcast) ? (nextBroadcast(a.broadcast) - 7 * 86400e3 > Date.now() - 3 * 3600e3
            ? '<p class="card-meta" style="margin-top:12px">A new episode should be out about now. Refresh in a little while if it isn\'t listed yet.</p>'
            : `<p class="card-meta" style="margin-top:12px">Next episode ${localTime(nextBroadcast(a.broadcast))}, in ${fmtCountdown(Math.round((nextBroadcast(a.broadcast) - Date.now()) / 1000))}</p>`) : ''}
          ${IS_CINEMEE && a.nextAiring?.airingAt > Date.now() ? `<p class="card-meta" style="margin-top:12px">Next episode (S${a.nextAiring.season} · E${a.nextAiring.episode}) ${localTime(a.nextAiring.airingAt)} your time, in ${fmtCountdown(Math.round((a.nextAiring.airingAt - Date.now()) / 1000))}</p>` : ''}
        </div>
      </div>
    </section>

    <div class="detail-grid">
      <div>
        <section class="section" style="margin-top:12px">
          <div class="desc clamp" id="desc">${esc(a.description || 'No description yet.')}</div>
          ${(a.description || '').length > 400 ? '<button class="link-btn" id="more">Read more</button>' : ''}
        </section>
        ${a.trailer ? section('Trailer', `<button class="trailer trailer-poster" type="button" id="trailer-play" data-key="${esc(a.trailer)}" aria-label="Play the trailer" style="background-image:url('https://i.ytimg.com/vi/${esc(a.trailer)}/hqdefault.jpg')"><span>▶</span></button>`) : ''}
        <div id="seasons"></div>
        <div id="related">${a.relations.length ? section('Related', grid(a.relations)) : ''}</div>
        <div id="extras-chars"></div>
        <div id="extras-recs"></div>
      </div>
      <aside>
        <section class="section" style="margin-top:12px">
          <div class="info-box" id="info-box">
            ${isMovie(a) ? `<div><b>Released</b><span>${fmtDate(a.startDate)}</span></div>`
              : IS_MANGEE ? (a.year ? `<div><b>Started</b><span>${a.year}</span></div>` : '')
              : `<div><b>Aired</b><span>${fmtDate(a.startDate)} – ${a.status === 'RELEASING' ? 'now' : fmtDate(a.endDate)}</span></div>`}
            ${IS_CINEMEE && a.nextAiring?.airDate ? `<div><b>Next episode</b><span>S${a.nextAiring.season} · E${a.nextAiring.episode}, ${a.nextAiring.airingAt ? new Date(a.nextAiring.airingAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(a.nextAiring.airDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>` : ''}
            ${IS_CINEMEE && a.rating ? `<div><b>Rated</b><span>${esc(a.rating)}</span></div>` : ''}
            ${a.season ? `<div><b>Season</b><span>${SEASON[a.season]} ${a.year || ''}</span></div>` : ''}
            ${a.studios.length ? `<div><b>${IS_CINEMEE && !isMovie(a) ? 'Network' : IS_MANGEE ? 'By' : 'Studio'}</b><span>${(a.studioLinks?.length ? a.studioLinks.map((st) => `<a href="/search?studio=${st.id}&studioName=${encodeURIComponent(st.name)}">${esc(st.name)}</a>`) : a.studios.map(esc)).join(', ')}</span></div>` : ''}
            ${a.source ? `<div><b>Source</b><span>${esc(a.source.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</span></div>` : ''}
            ${a.popularity ? `<div><b>${IS_CINEMEE ? 'Votes' : IS_MANGEE ? 'Followers' : 'Members'}</b><span>${a.popularity.toLocaleString()}</span></div>` : ''}
            ${a.synonyms.length ? `<div><b>Also</b><span>${esc(a.synonyms.slice(0, 3).join(', '))}</span></div>` : ''}
            <div><b>Elsewhere</b><span class="out-links">${IS_MANGEE && a.mdId
              ? `<a href="https://mangadex.org/title/${esc(a.mdId)}" target="_blank" rel="noopener">MangaDex ↗</a>${a.officialUrl ? ` <a href="${esc(a.officialUrl)}" target="_blank" rel="noopener">Official ↗</a>` : ''}`
              : IS_CINEMEE && a.tmdbId
              ? `<a href="https://www.themoviedb.org/${isMovie(a) ? 'movie' : 'tv'}/${esc(a.tmdbId)}" target="_blank" rel="noopener">TMDB ↗</a>`
              : `<a href="https://myanimelist.net/anime/${esc(a.id)}" target="_blank" rel="noopener">MyAnimeList ↗</a> <a id="anilist-link" hidden target="_blank" rel="noopener">AniList ↗</a>`}</span></div>
          </div>
        </section>
        ${a.streamingLinks.length ? section('Official streams', `<div class="links">${a.streamingLinks.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ↗</a>`).join('')}</div>`) : ''}
      </aside>
    </div>`;

  bindListSelect(a);
  bindFollow(a);
  // AniList link: its id is looked up in the browser (AniList refuses Cloudflare's servers).
  if (!IS_CINEMEE && !IS_MANGEE) aniList.aniListIdFor(a.id).then((al) => {
    const link = document.getElementById('anilist-link');
    if (al && link) { link.href = `https://anilist.co/anime/${al}`; link.hidden = false; }
  });
  bindListButtons(a);
  bindRatingSelect(a, document.getElementById('my-rating'));
  // The trailer loads YouTube's player only when you ask for it.
  const trailerBtn = document.getElementById('trailer-play');
  if (trailerBtn) trailerBtn.onclick = () => {
    trailerBtn.outerHTML = `<iframe class="trailer" src="https://www.youtube-nocookie.com/embed/${esc(trailerBtn.dataset.key)}?autoplay=1" title="Trailer" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  };
  bindShare(a);
  loadExtras(a.id, alive, { chars: 'extras-chars', recs: 'extras-recs', ratings: 'info-box' });
  // How many episodes actually stream, in sub and dub.
  if (canWatch) api(`/anime/${a.id}/availability`).then((d) => {
    const chip = document.getElementById('avail-chip');
    if (!alive() || !chip) return;
    chip.hidden = false;
    if (!d.sub && !d.dub) {
      chip.textContent = 'Not streaming yet';
      const watch = app.querySelector('.hero .btn.primary');
      if (watch) watch.outerHTML = '<span class="btn" aria-disabled="true">Not available to stream yet</span>';
      return;
    }
    chip.textContent = `Sub ${d.sub} · Dub ${d.dub}`;
    chip.title = 'Episodes available to stream';
  }).catch(() => {});
  // Once the seasons strip is in, "Related" keeps only titles that aren't already in it.
  loadSeasons(a, alive, 'seasons', 'anime', (inStrip) => {
    const rest = a.relations.filter((r) => !inStrip.has(r.id));
    document.getElementById('related').innerHTML = rest.length ? section('Related', grid(rest)) : '';
  });
  const more = document.getElementById('more');
  if (more) more.onclick = () => {
    const d = document.getElementById('desc');
    d.classList.toggle('clamp');
    more.textContent = d.classList.contains('clamp') ? 'Read more' : 'Show less';
  };
}

// ---------- nav search with suggestions ----------
export function setupSearch() {
  const form = document.getElementById('nav-search');
  const input = form.querySelector('input');
  const box = document.getElementById('suggest');
  let timer = null;
  let seq = 0;

  // Recent searches (this browser only), shown when the empty box gets focus.
  const RECENT_KEY = 'animee-space:recent-searches';
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
  const remember = (q) => {
    const list = [q, ...recent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  };
  const showRecent = () => {
    const list = recent();
    if (!list.length) { box.hidden = true; return; }
    box.innerHTML = '<div class="s-head">Recent searches <button type="button" class="link-btn" data-clear-recent>Clear</button></div>'
      + list.map((q) => `<a class="s-recent" href="/search?q=${encodeURIComponent(q)}">↺ ${esc(q)}</a>`).join('');
    box.hidden = false;
  };
  box.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-recent]')) return;
    e.preventDefault(); e.stopPropagation();
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
    box.hidden = true;
    input.focus();
  }, true);
  input.addEventListener('focus', () => { if (!input.value.trim()) showRecent(); });
  // The title that matched, when it isn't the one shown (an English or Japanese name).
  const alsoKnown = (a, q) => {
    const needle = q.toLowerCase();
    if (String(T(a)).toLowerCase().includes(needle)) return '';
    const hit = [a.title, a.titleRomaji, ...(a.synonyms || [])].find((t) => t && String(t).toLowerCase().includes(needle));
    return hit && hit !== T(a) ? hit : '';
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    box.hidden = true;
    input.blur();
    if (q) { remember(q); go('/search?q=' + encodeURIComponent(q)); }
  };
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const my = ++seq;
    if (!q) { showRecent(); return; }
    if (q.length < 3) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const d = await api('/search?q=' + encodeURIComponent(q));
        if (my !== seq) return;
        const results = Array.isArray(d.results) ? d.results : [];
        box.innerHTML = (d.approximate && results.length ? `<div class="s-head">No exact match. Did you mean…</div>` : '')
          + (results.length ? results.slice(0, 6).map((a) => {
            const aka = alsoKnown(a, q);
            return `<a href="${animeHref(a)}"><img src="${esc(a.cover)}" alt="">
            <div><div class="s-title">${esc(T(a))}</div><div class="s-meta">${aka ? `also “${esc(aka)}” · ` : ''}${[FORMAT[a.format], a.year, STATUS[a.status]].filter(Boolean).join(' · ')}</div></div></a>`;
          }).join('') : `<div class="s-empty">No matches found. <a href="${esc(SIBLING.origin)}/search?q=${encodeURIComponent(q)}">Try ${SIBLING.name} ↗</a></div>`)
          + `<a class="s-all" href="/search?q=${encodeURIComponent(q)}">View all results ›</a>`;
        box.hidden = false;
        input.setAttribute('aria-expanded', 'true');
      } catch { if (my === seq) box.hidden = true; }
    }, 300);
  };
  const close = () => { clearTimeout(timer); seq++; box.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  input.setAttribute('aria-controls', 'suggest');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-autocomplete', 'list');
  box.onclick = (e) => {
    const q = input.value.trim();
    // A picked suggestion is remembered by its title (not a typo); "View all" by what was typed.
    const picked = e.target.closest('a')?.querySelector('.s-title')?.textContent;
    if (picked) remember(picked); else if (q && e.target.closest('a:not(.s-recent)')) remember(q);
    close();
    input.value = '';
  };
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  // Any route change (a picked result, Back, a link elsewhere) closes the list.
  window.addEventListener('animee:navigate', close);
  // Arrow keys move through the suggestions, Enter opens the highlighted one, Escape closes.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (box.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const links = [...box.querySelectorAll('a')];
    if (!links.length) return;
    e.preventDefault();
    links[e.key === 'ArrowDown' ? 0 : links.length - 1].focus();
  });
  box.addEventListener('keydown', (e) => {
    const links = [...box.querySelectorAll('a')];
    const at = links.indexOf(document.activeElement);
    if (e.key === 'Escape') { close(); input.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = at + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= links.length) input.focus();
    else links[next].focus();
  });
}

// ---------- boot ----------
// Install as an app: keep the browser's install prompt for the Settings button.
export let installPrompt = null;
/** The browser's install prompt, once (Settings → Install app); null when there isn't one. */
export function takeInstallPrompt() { const p = installPrompt; installPrompt = null; return p; }
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
document.getElementById('menu-btn').onclick = (e) => {
  const open = document.getElementById('nav-links').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
};
// The phone menu closes (and says so) when you go somewhere.
window.addEventListener('animee:navigate', () => {
  document.getElementById('nav-links').classList.remove('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
});
setupSearch();
// Old #/ links (shared before paths existed) become real paths.
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/');
window.addEventListener('popstate', route);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return;
  const path = a.pathname;
  if (path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) return;
  if (a.getAttribute('href').startsWith('#')) return; // in-page anchors such as the skip link
  e.preventDefault();
  if (path + a.search === location.pathname + location.search) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  go(path + a.search + a.hash);
});

// "New" badge: count of new episodes, refreshed in the background at most every 30 minutes.
export const newBadge = document.getElementById('nav-new-count');
export const showBadge = (items) => { if (newBadge) { newBadge.textContent = items.length; newBadge.hidden = !items.length; } };
inbox.onInboxChange(showBadge);
showBadge(inbox.inboxItems());
window.addEventListener('animee:navigate', () => showBadge(inbox.inboxItems()));

// account label in the nav + refresh list pages after the first sync
export const navAccount = document.getElementById('nav-account');
export let firstSync = true;
store.onSyncChange(({ user, synced, changed }) => {
  navAccount.textContent = user ? user.name : 'Sign in';
  if (synced && (firstSync || changed?.size)) {
    firstSync = false;
    const page = parseHash().parts[0];
    if (page === undefined || page === 'watchlist') route(); // never interrupt the player
  }
});

// A notice from the site owner (set on /admin), until it expires or you close it.
export const NOTICE_KEY = 'animee-space:notice-closed';
export function showNotice() {
  fetch('/api/notice').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const n = d?.notice;
    let closed = '';
    try { closed = localStorage.getItem(NOTICE_KEY) || ''; } catch { /* ignore */ }
    document.getElementById('site-notice')?.remove();
    if (!n || closed === n.id) return;
    const el = document.createElement('div');
    el.id = 'site-notice';
    el.className = `site-notice ${n.level === 'warn' ? 'warn' : ''}`;
    el.setAttribute('role', 'status');
    const safeLink = n.link && (/^\/(?!\/)/.test(n.link) || /^https:\/\//.test(n.link)) ? n.link : '';
    el.innerHTML = `<span>${n.level === 'warn' ? '⚠ ' : ''}${esc(n.text)}${safeLink ? ` <a href="${esc(safeLink)}"${safeLink.startsWith('https:') ? ' target="_blank" rel="noopener"' : ''}>More</a>` : ''}</span>
      <button type="button" aria-label="Close this notice">✕</button>`;
    el.querySelector('button').onclick = () => {
      try { localStorage.setItem(NOTICE_KEY, n.id); } catch { /* ignore */ }
      el.remove();
    };
    app.before(el);
  }).catch(() => {});
}

// Before the first page renders: the player builds itself differently on a TV.
initTv();
route();
showNews();
showNotice();
// The footer's link to the other site follows the current address (cinemee.localhost in development).
document.querySelectorAll('.sibling-link').forEach((a) => { a.href = `${SIBLING.origin}/`; });
store.initAccount().finally(() => setTimeout(() => {
  inbox.refreshInbox().catch(() => {});
  push.syncFollows(); // follows may have changed on another device
}, 1500));
