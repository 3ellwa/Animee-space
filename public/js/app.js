import { api } from './api.js';
import * as store from './store.js';
import { Player } from './player.js';
import './fx.js';
import * as inbox from './inbox.js';
import * as push from './push.js';
import * as aniList from './anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from './site.js';

const app = document.getElementById('app');
let cleanups = [];
let navToken = 0;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMAT = { TV: IS_CINEMEE ? 'TV series' : 'TV', TV_SHORT: 'TV Short', TV_SPECIAL: 'TV Special', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const STATUS = IS_CINEMEE
  ? { RELEASING: 'On air', FINISHED: 'Complete', NOT_YET_RELEASED: 'Coming soon', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' }
  : { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' };
const SEASON = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
const TYPE_OPTIONS = IS_CINEMEE ? [['movie', 'Movie'], ['tv', 'TV show']]
  : [['tv', 'TV series'], ['movie', 'Movie'], ['ova', 'OVA'], ['ona', 'ONA'], ['special', 'Special'], ['music', 'Music']];
const STATUS_OPTIONS = IS_CINEMEE ? [['airing', 'On air now'], ['upcoming', 'Coming soon']]
  : [['airing', 'Airing now'], ['complete', 'Finished'], ['upcoming', 'Not aired yet']];
const SEASON_OPTIONS = [['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall']];
const RATING_OPTIONS = [['g', 'G, all ages'], ['pg', 'PG, children'], ['pg13', 'PG-13, teens'], ['r17', 'R, 17+']];
const ORDER_OPTIONS = [['popular', 'Most popular'], ['score', 'Best rated'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['title', 'Title A-Z']];
const LIST_TITLES = IS_CINEMEE
  ? { airing: 'On TV this week', popular: 'Trending this week', favorite: 'Top rated', upcoming: 'Coming to cinemas', season: 'In cinemas now', completed: 'Complete series' }
  : { airing: 'Top airing', popular: 'Most popular', favorite: 'Most favourited', upcoming: 'Coming soon', season: 'This season', completed: 'Just completed' };
// Short paths that open the browse page with a preset filter.
const SHORTCUTS = IS_CINEMEE ? { tv: 'type=tv', movies: 'type=movie', airing: 'status=airing', upcoming: 'status=upcoming' }
  : { tv: 'type=tv', movies: 'type=movie', ova: 'type=ova', ona: 'type=ona', specials: 'type=special', airing: 'status=airing', upcoming: 'status=upcoming' };
const MAX_GENRES = 5;
// cinemee ids end in 1 for movies and 2 for TV (see functions/_lib/providers/tmdb.js).
const isMovie = (a) => IS_CINEMEE && (a?.format === 'MOVIE' || /1$/.test(String(a?.id ?? a?.animeId ?? '')));
// "S1 · E3" for TV episodes on cinemee, "Episode 3" everywhere else.
const epName = (ep) => (ep?.label ? ep.label : `Episode ${ep?.number ?? ep}`);
// How long a title is, for chips and cards.
function lengthLabel(a) {
  if (!IS_CINEMEE) return `${epsLabel(a)} eps`;
  if (isMovie(a)) return a.duration ? `${Math.floor(a.duration / 60) ? `${Math.floor(a.duration / 60)}h ` : ''}${a.duration % 60}m` : '';
  return [a.seasonCount ? `${a.seasonCount} season${a.seasonCount === 1 ? '' : 's'}` : '', a.availableEpisodes ? `${a.availableEpisodes} episodes` : ''].filter(Boolean).join(' · ');
}
const score = (s) => (s ? (s / 10).toFixed(1) : null);
const fmtDate = (d) => (d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', ...(d.day ? { day: 'numeric' } : {}) }) : '?');
const fmtCountdown = (sec) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
// The brand's ^^. face. Its eyes blink, and the loader bounces the dot.
const HAPPY = '<svg class="happy" viewBox="0 0 48 24" aria-hidden="true"><path class="eye" d="M3 20.5 L10 6 L17 20.5"/><path class="eye" d="M24 20.5 L31 6 L38 20.5"/><circle class="dot" cx="45" cy="20.6" r="2.9"/></svg>';
const loader = () => `<div class="loader" role="status"><span class="loader-face">${HAPPY}</span><span class="sr-only">Loading</span></div>`;
const onCleanup = (fn) => cleanups.push(fn);
// 754 -> "12:34", 3800 -> "1:03:20"
const clock = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
// The title to show, following the English / Japanese setting.
const T = (a) => (store.getSettings().titles === 'japanese' && a?.titleRomaji ? a.titleRomaji : a?.title || '');
// Rows and picks leave out shows marked "Not interested", and shows already started when that setting is on.
const unstarted = (list) => {
  const hidden = store.notInterestedIds();
  if (store.getSettings().hideStarted) for (const id of store.startedIds()) hidden.add(id);
  return withoutHiddenGenres(hidden.size ? list.filter((a) => !hidden.has(String(a.id))) : list);
};
// Settings → Hide genres: shows in those genres stay out of rows, picks and browsing.
function withoutHiddenGenres(list, except = []) {
  const skip = (store.getSettings().hiddenGenres || []).filter((g) => !except.includes(g));
  if (!skip.length) return list;
  return list.filter((a) => !(a.genres || []).some((g) => skip.includes(g)));
}
// Reads a file the viewer picked as text.
const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(new Error('Could not read that file.'));
  r.readAsText(file);
});

function epsLabel(a) {
  const have = Number(a.availableEpisodes ?? a.episodes) || 0;
  
  return have || a.episodes || '?';
}

// Every card remembers its show, so the poster's save button can add it without another lookup.
const cardShows = new Map();
function card(a) {
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
const BROADCAST_DAYS = ['mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays'];
function nextBroadcast(b) {
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
const localTime = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// A shelf: one horizontal row of posters with arrow buttons. Its list loads the first time the
// row comes near the screen, so the home page doesn't ask for every list at once.
function shelf(id, title, sub, more = '') {
  return `<section class="section shelf" id="${id}">
    <div class="section-head">
      <div class="shelf-title"><h2>${title}</h2>${sub ? `<p class="shelf-sub">${sub}</p>` : ''}</div>
      <div class="shelf-nav">${more}<button class="arrow" data-dir="-1" aria-label="Scroll left" disabled>‹</button><button class="arrow" data-dir="1" aria-label="Scroll right">›</button></div>
    </div>
    <div class="shelf-track">${loader()}</div>
  </section>`;
}
const shelfCards = (list) => list.map(card).join('');
// Top 10 as a shelf: a big outlined rank number leaning on each poster.
const rankCards = (list) => list.map((a, i) => `<a class="rank-card" href="${animeHref(a)}" title="${esc(T(a))}">
    <span class="rank-num">${i + 1}</span>
    <span class="poster"><img loading="lazy" src="${esc(a.cover)}" alt="${esc(T(a))} poster"></span>
    <span class="rank-title">${esc(T(a))}</span>
  </a>`).join('');
function bindShelf(id, load, alive) {
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
const grid = (list) => (list?.length ? `<div class="grid">${list.map(card).join('')}</div>` : '<div class="empty">Nothing here yet.</div>');
const section = (title, body, more = '') => `<section class="section"><div class="section-head"><h2>${title}</h2>${more}</div>${body}</section>`;

// ---------- router ----------
// Real paths (/anime/52991/frieren-…), so every page can be indexed and shared. Links inside the
// site are handled here without a full reload; old #/ links are converted once on load.
function parseHash() {
  return { parts: location.pathname.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(location.search) };
}
const slugify = (t) => String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// The English title makes the slug, so a show keeps one address whatever the title setting.
// animee: /anime/123/slug. cinemee: /movie/5501/fight-club or /tv/13992/game-of-thrones.
const animeHref = (a) => `/${IS_CINEMEE ? (/1$/.test(String(a.id)) ? 'movie' : 'tv') : 'anime'}/${a.id}${a.title ? '/' + slugify(a.title) : ''}`;
function go(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  route();
}

function setActiveNav(key) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  document.getElementById('nav-links').classList.remove('open');
}

async function route() {
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
      case 'watch': return await viewWatch(parts[1], query, alive);
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
function offlineNote() {
  return `<div class="empty"><h2>You're offline</h2><p>Your list, history and stats are saved in this browser and still work.</p>
    <p class="actions" style="justify-content:center"><a class="btn primary" href="/watchlist">My list</a> <a class="btn" href="/watchlist?tab=history">History</a> <a class="btn" href="/stats">Stats</a></p></div>`;
}
window.addEventListener('offline', () => toastNote('You’re offline. Your list, history and stats still work.'));
window.addEventListener('online', () => toastNote('Back online.'));

async function viewHome(alive) {
  if (!navigator.onLine) { app.innerHTML = offlineNote(); return; }
  const d = await api('/home');
  if (!alive()) return;
  const season = d.recent || [];
  const cont = store.getSettings().showContinue ? store.continueList().filter(p => p.title) : [];
  const quick = IS_CINEMEE
    ? [['Movies', '/movies'], ['TV shows', '/tv'], ['On air now', '/airing'], ['Coming soon', '/upcoming'],
      ['Schedule', '/schedule'], ['Help me pick', '/pick'], ['All filters', '/search'], ['Random', '/random']]
    : [['TV series', '/tv'], ['Movies', '/movies'], ['Airing now', '/airing'], ['Coming soon', '/upcoming'],
      ['Schedule', '/schedule'], ['Help me pick', '/pick'], ['A-Z', '/az'], ['All filters', '/search'], ['Random', '/random']];
  app.innerHTML =
    `<h1 class="sr-only">${BRAND.title}: ${IS_CINEMEE ? 'watch movies and TV' : 'watch anime'}</h1>` +
    spotlight(season.filter((x) => !store.notInterestedIds().has(String(x.id))).slice(0, 8)) +
    `<nav class="quick" aria-label="Shortcuts">${quick.map(([label, href]) => `<a class="chip" href="${href}">${label}</a>`).join('')}</nav>` +
    (cont.length ? section('Continue watching', '<div class="row">' + cont.map(contCard).join('') + '</div>') : '') +
    '<div id="sibling-cont"></div>' +
    '<div id="picked"></div>' +
    (IS_CINEMEE
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
    bindShelf('shelf-picked', async () => shelfCards(unstarted(mixed).slice(0, 16)), alive);
  }).catch(() => {});

  Promise.resolve(d.genres ? { genres: d.genres } : api('/genres')).then(({ genres }) => {
    if (!alive()) return;
    document.getElementById('home-genres').innerHTML = `<div class="section-head"><h2>Browse by genre</h2><a href="/search">All filters ›</a></div>
      <div class="chips">${genres.map((g) => `<a class="chip" href="/search?genres=${encodeURIComponent(g)}&order=score">${esc(g)}</a>`).join('')}</div>`;
  }).catch(() => {});
}

// The other site on the home page: what you're watching there (signed in on both), otherwise a
// small card about it that can be closed (it comes back after 60 days).
const SIBLING_CACHE = 'animee-space:sibling-continue';
const PROMO_KEY = 'animee-space:sibling-promo-closed';
async function siblingContinue() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(SIBLING_CACHE) || 'null');
    if (hit && hit.at > Date.now() - 5 * 60e3) return hit.data;
  } catch { /* ignore */ }
  const r = await fetch(`${SIBLING.origin}/api/me/continue`, { credentials: 'include' });
  const data = r.ok ? await r.json() : { items: [] };
  try { sessionStorage.setItem(SIBLING_CACHE, JSON.stringify({ at: Date.now(), data })); } catch { /* ignore */ }
  return data;
}
function loadSibling(alive) {
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
      <div><b>Also by us: <span class="sib-name">${SIBLING.name}</span></b><p>${esc(SIBLING.pitch)} Free, same as here (it has its own account).</p></div>
      <div class="actions"><a class="btn primary" href="${esc(SIBLING.origin)}/">Open ${SIBLING.name} ↗</a><button class="link-btn" type="button" data-close>Not now</button></div>
    </div></section>`;
    slot.querySelector('[data-close]').onclick = () => {
      try { localStorage.setItem(PROMO_KEY, String(Date.now())); } catch { /* ignore */ }
      slot.innerHTML = '';
    };
  });
}

// For shows where the last opened episode is finished, check whether the next one is out.
function checkNewEpisodes(cont, alive) {
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
const ART_KEY = 'animee-space:art';
const ART_TTL = 3 * 86400e3;
const KITSU = 'https://kitsu.app/api/edge/mappings?filter[externalSite]=myanimelist/anime&include=item&fields[anime]=coverImage&page[limit]=20&filter[externalId]=';
// Kitsu's original upload when it's a JPEG (a few hundred KB, true aspect); its PNG originals can
// be several MB, so those use the 3360x800 JPEG copy instead.
function kitsuArt(cover) {
  if (!cover) return null;
  if (typeof cover.original === 'string' && /\.jpe?g(\?|$)/i.test(cover.original)) return cover.original;
  return typeof cover.large === 'string' ? cover.large : null;
}
async function fromKitsu(ids) {
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
async function fromAniList(ids) {
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
async function loadBanners(ids) {
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
const wideScreen = () => matchMedia('(min-width: 761px)').matches;
// Art loads one slide at a time (the current one and the next), not all eight at once.
function loadSlideArt(slide) {
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

function bindSpotlight(alive) {
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
  onCleanup(() => clearInterval(timer));
}

// Spotlight art: the cover as a blurred backdrop with the sharp poster beside it, until the
// show's wide art arrives (see loadBanners) and fades in over the top.
function spotlight(list) {
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
            <a class="btn primary" href="/watch/${a.id}">▶ Watch now</a>
            <a class="btn" href="${animeHref(a)}">Details ›</a>
          </div>
        </div>
      </div>`).join('')}
    <div class="dots">${list.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>
  </section>`;
}

function contCard(p) {
  const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
  return `<a class="cont" href="/watch/${p.animeId}?ep=${p.ep}">
    <img src="${esc(p.cover)}" alt="${esc(p.title)} poster" loading="lazy">
    <div style="min-width:0;flex:1">
      <div class="c-title">${esc(p.title)}</div>
      <div class="c-meta">${isMovie(p) ? 'Movie' : `Episode ${p.ep}`}</div>
      <span class="new-ep" hidden></span>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>
    <button class="x" data-id="${p.animeId}" aria-label="Remove">✕</button>
  </a>`;
}

function top10(list) {
  return `<div class="top10">${(list || []).map((a, i) => `
    <a href="${animeHref(a)}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <img src="${esc(a.cover)}" alt="${esc(T(a))} poster" loading="lazy">
      <div><div class="t">${esc(T(a))}</div><div class="m">${[FORMAT[a.format], a.score ? `★ ${score(a.score)}` : ''].filter(Boolean).join(' · ')}</div></div>
    </a>`).join('')}</div>`;
}

// ---------- search / browse ----------
function selectField(name, label, options, value, anyLabel) {
  return `<label class="field"><span>${label}</span><select name="${name}">
    <option value="">${anyLabel}</option>
    ${options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}
  </select></label>`;
}

async function viewSearch(q, alive) {
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
async function viewList(name, alive) {
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
async function viewRandom(alive) {
  const { id } = await api('/random', { fresh: true });
  if (alive()) go(`/anime/${id}?from=random`, { replace: true });
}

// ---------- anime details ----------
function bindShare(a) {
  const btn = document.getElementById('share');
  if (!btn) return;
  btn.onclick = async () => {
    const url = `${location.origin}${animeHref(a)}`;
    if (navigator.share) return navigator.share({ title: a.title, url }).catch(() => {});
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied'; } catch { prompt('Copy this link', url); }
  };
}

// The whole franchise in watching order, with the current title marked.
function loadSeasons(a, alive, slotId, linkTo = 'anime', onLoaded) {
  api(`/anime/${a.id}/seasons`).then(({ seasons }) => {
    const slot = document.getElementById(slotId);
    if (!alive() || !slot || seasons.length < 2) return;
    // cinemee TV: the show's own seasons, each opening its first episode (title page only; the
    // watch page already picks episodes season by season).
    if (seasons[0].season) {
      if (linkTo !== 'anime') return;
      slot.innerHTML = `<section class="section seasons">
        <div class="section-head"><h2>Seasons</h2></div>
        <p class="card-meta">${seasons.length} seasons</p>
        <div class="season-row">${seasons.map((s) => {
          const inner = `<img src="${esc(s.cover)}" alt="${esc(s.title)} poster" loading="lazy">
            <span class="season-info">
              <small>${[s.year, s.episodes ? `${s.episodes} episodes` : ''].filter(Boolean).join(' · ')}</small>
              <b>${esc(s.title)}</b>
              ${s.startEp ? '' : `<span class="here-badge">${s.airDate ? `Starts ${new Date(s.airDate + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Coming later'}</span>`}
            </span>`;
          return s.startEp ? `<a class="season" href="/watch/${a.id}?ep=${s.startEp}">${inner}</a>` : `<div class="season">${inner}</div>`;
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
function loadExtras(id, alive, slots) {
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
    if (recs && x.recommendations?.length) recs.innerHTML = section('You might also like', grid(store.notInterestedIds().size ? x.recommendations.filter((r) => !store.notInterestedIds().has(String(r.id))).slice(0, slots.limit || 12) : x.recommendations.slice(0, slots.limit || 12)));
  }).catch(() => {});
}

function listSelect(a) {
  const entry = store.getEntry(a.id);
  return `<select id="list-status" aria-label="Watchlist">
    <option value="">${entry?.status ? 'Remove from list' : '＋ Add to list'}</option>
    ${store.LIST_STATUSES.map(([k, l]) => `<option value="${k}"${entry?.status === k ? ' selected' : ''}>${l}</option>`).join('')}
  </select>`;
}
function bindListSelect(a) {
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
const canFollow = (a) => a.status === 'RELEASING' || a.status === 'NOT_YET_RELEASED';
function followButton(a, small = false) {
  if (!canFollow(a)) return '';
  const on = store.isFollowing(a.id);
  const upcoming = a.status === 'NOT_YET_RELEASED';
  const label = upcoming ? (on ? '🔔 Reminder on' : '🔕 Remind me when it starts') : on ? '🔔 Following' : '🔕 Follow';
  return `<button class="btn${small ? ' sm' : ''}${on ? ' active' : ''}" id="follow-btn" type="button" aria-pressed="${on}"
    title="${upcoming ? 'Get told when episode 1 is out' : 'Get new episodes in Notifications'}${'Notification' in window ? ' (and as pop-ups)' : ''}">${label}</button>`;
}
function bindFollow(a, small = false) {
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
const ART_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 225 318"><rect width="225" height="318" fill="#121417"/><path d="M78 168 L92 144 L106 168 M120 168 L134 144 L148 168" fill="none" stroke="#5B6169" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>');
window.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.fallback || img.classList.contains('slide-art')) return;
  img.dataset.fallback = '1';
  img.src = ART_PLACEHOLDER;
}, true);

// Page crashes are counted (view + first line of the message, nothing else) for the admin page.
// At most three per page load, and only errors from this site's own scripts.
let errorsSent = 0;
function sendError(message, source = '') {
  if (errorsSent >= 3 || !message) return;
  if (source && !String(source).startsWith(location.origin)) return; // extensions, players
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
const canPreview = () => matchMedia('(hover: hover) and (pointer: fine) and (min-width: 900px)').matches;
let previewTimer = 0;
let previewClose = 0;
let previewFor = '';
function closePreview() {
  clearTimeout(previewTimer);
  document.getElementById('hover-card')?.remove();
  previewFor = '';
}
function placePreview(el, cardEl) {
  const r = cardEl.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const right = r.right + 12 + w <= innerWidth - 8;
  const left = right ? r.right + 12 : Math.max(8, r.left - 12 - w);
  const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), innerHeight - h - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}
async function openPreview(cardEl) {
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
function undoToast(text, undo) {
  toastNote(`${esc(text)} <button class="link-btn" type="button" data-undo>Undo</button>`);
  const b = document.querySelector('.toast [data-undo]');
  if (b) b.onclick = () => { undo(); document.querySelector('.toast')?.remove(); };
}

// The poster save menu: list status, favourite, not interested.
function openSaveMenu(button, a) {
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
function closeSaveMenu() { document.querySelector('.save-menu')?.remove(); }
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
function toastNote(html) {
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
function listButtons(a) {
  const entry = store.getEntry(a.id);
  const fav = !!entry?.favourite;
  const ni = entry?.status === 'notinterested';
  return `<span class="list-buttons" id="list-buttons">
    <button class="btn${fav ? ' active' : ''}" id="fav-btn" type="button" aria-pressed="${fav}">${fav ? '♥ Favourite' : '♡ Favourite'}</button>
    <button class="btn${ni ? ' active' : ''}" id="ni-btn" type="button" aria-pressed="${ni}" title="Hide from home rows, picks and recommendations">${ni ? '✕ Not interested' : 'Not interested'}</button>
  </span>`;
}
function refreshListButtons(a) {
  const box = document.getElementById('list-buttons');
  if (!box) return;
  box.outerHTML = listButtons(a);
  bindListButtons(a);
}
// Your own 1-10 rating (title pages and the poster menu).
const RATING_WORDS = ['', 'Appalling', 'Horrible', 'Very bad', 'Bad', 'Average', 'Fine', 'Good', 'Very good', 'Great', 'Masterpiece'];
function ratingSelect(a, id = 'my-rating') {
  const r = store.getRating(a.id);
  return `<select id="${id}" class="rating-select${r ? ' rated' : ''}" aria-label="Your rating for ${esc(T(a))}">
    <option value="0">${r ? 'Remove my rating' : '★ Rate it'}</option>
    ${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}"${r === n ? ' selected' : ''}>★ ${n} · ${RATING_WORDS[n]}</option>`).join('')}
  </select>`;
}
function bindRatingSelect(a, el) {
  if (!el) return;
  el.onchange = () => {
    store.setRating(a, el.value);
    const r = store.getRating(a.id);
    el.classList.toggle('rated', Boolean(r));
    el.options[0].textContent = r ? 'Remove my rating' : '★ Rate it';
    toastNote(r ? `You rated ${esc(T(a))} <b>${r}/10</b>.` : 'Rating removed.');
  };
}
function bindListButtons(a) {
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

async function viewAnime(id, alive, query = new URLSearchParams()) {
  if (!id) return viewNotFound();
  const a = await api(`/anime/${id}`);
  if (!alive()) return;
  document.title = `${a.title} · ${BRAND.title}`;
  store.rememberMeta(a);
  // Old or slug-less links settle on the show's one canonical address.
  if (location.pathname !== animeHref(a)) history.replaceState(null, '', animeHref(a) + location.search);
  const prog = store.getProgress(a.id);
  // An airing show can be missing its episode count; it still has episodes to watch.
  const canWatch = a.availableEpisodes > 0 || a.status === 'RELEASING';

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
            ${canWatch && !IS_CINEMEE ? '<span class="chip avail" id="avail-chip" hidden></span>' : ''}
            ${[...a.genres, ...(a.themes || [])].map((g) => `<a class="chip" href="/search?genres=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
          </div>
          <div class="actions">
            ${canWatch
              ? `<a class="btn primary" href="/watch/${a.id}${prog ? `?ep=${prog.ep}` : ''}">▶ ${prog ? (isMovie(a) ? 'Resume' : IS_CINEMEE ? `Continue episode ${prog.ep}` : `Continue EP ${prog.ep}`) : 'Watch now'}</a>`
              : '<span class="btn" aria-disabled="true">Not released yet</span>'}
            ${listSelect(a)}
            ${followButton(a)}
            ${canWatch && !isMovie(a) && a.availableEpisodes > 1 ? `<a class="btn" href="/watch/${a.id}?ep=${a.availableEpisodes}">Newest: episode ${a.availableEpisodes}</a>` : ''}
            ${canWatch && prog && !isMovie(a) && prog.ep > 1 ? `<a class="btn" href="/watch/${a.id}?ep=1">From episode 1</a>` : ''}
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
        ${a.trailer ? section('Trailer', `<iframe class="trailer" src="https://www.youtube-nocookie.com/embed/${esc(a.trailer)}" title="Trailer" allowfullscreen loading="lazy"></iframe>`) : ''}
        <div id="seasons"></div>
        <div id="related">${a.relations.length ? section('Related', grid(a.relations)) : ''}</div>
        <div id="extras-chars"></div>
        <div id="extras-recs"></div>
      </div>
      <aside>
        <section class="section" style="margin-top:12px">
          <div class="info-box" id="info-box">
            ${isMovie(a) ? `<div><b>Released</b><span>${fmtDate(a.startDate)}</span></div>`
              : `<div><b>Aired</b><span>${fmtDate(a.startDate)} – ${a.status === 'RELEASING' ? 'now' : fmtDate(a.endDate)}</span></div>`}
            ${IS_CINEMEE && a.nextAiring?.airDate ? `<div><b>Next episode</b><span>S${a.nextAiring.season} · E${a.nextAiring.episode}, ${a.nextAiring.airingAt ? new Date(a.nextAiring.airingAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : new Date(a.nextAiring.airDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>` : ''}
            ${IS_CINEMEE && a.rating ? `<div><b>Rated</b><span>${esc(a.rating)}</span></div>` : ''}
            ${a.season ? `<div><b>Season</b><span>${SEASON[a.season]} ${a.year || ''}</span></div>` : ''}
            ${a.studios.length ? `<div><b>${IS_CINEMEE && !isMovie(a) ? 'Network' : 'Studio'}</b><span>${(a.studioLinks?.length ? a.studioLinks.map((st) => `<a href="/search?studio=${st.id}&studioName=${encodeURIComponent(st.name)}">${esc(st.name)}</a>`) : a.studios.map(esc)).join(', ')}</span></div>` : ''}
            ${a.source ? `<div><b>Source</b><span>${esc(a.source.replace(/_/g, ' ').toLowerCase())}</span></div>` : ''}
            ${a.popularity ? `<div><b>${IS_CINEMEE ? 'Votes' : 'Members'}</b><span>${a.popularity.toLocaleString()}</span></div>` : ''}
            ${a.synonyms.length ? `<div><b>Also</b><span>${esc(a.synonyms.slice(0, 3).join(', '))}</span></div>` : ''}
            <div><b>Elsewhere</b><span class="out-links">${IS_CINEMEE && a.tmdbId
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
  if (!IS_CINEMEE) aniList.aniListIdFor(a.id).then((al) => {
    const link = document.getElementById('anilist-link');
    if (al && link) { link.href = `https://anilist.co/anime/${al}`; link.hidden = false; }
  });
  bindListButtons(a);
  bindRatingSelect(a, document.getElementById('my-rating'));
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

// ---------- watch ----------
async function viewWatch(id, query, alive) {
  if (!id) return viewNotFound();
  // Show the page's shape straight away (player, episode panel) with what is being loaded,
  // using the poster this browser already knows, instead of a bare spinner.
  const known = store.getList()[id] || store.getProgress(id) || {};
  app.innerHTML = `
    <div class="watch-skel" aria-busy="true">
      <div class="crumbs card-meta">${known.title ? esc(known.title) : 'Loading…'}</div>
      <div class="watch-grid"><div>
        <div class="player skel-player"${known.cover ? ` style="--poster:url('${esc(known.cover)}')"` : ''}>
          <div class="pl-msg busy"><span class="pl-spin" aria-hidden="true"></span><span id="skel-step" role="status">Getting the show…</span></div>
        </div>
        <div class="skel-bar"></div>
      </div>
      <aside><div class="ep-box skel-eps">${'<i></i>'.repeat(24)}</div></aside></div>
    </div>`;
  const step = (text) => { const el = document.getElementById('skel-step'); if (el && alive()) el.textContent = text; };
  // The server list for the likely episode is fetched in parallel, so it's cached by the time it's needed.
  const guessEp = Number(query.get('ep')) || store.getProgress(id)?.ep || 1;
  // VidNest and TryEmbed need the show's AniList ID, which only the browser can look up
  // (AniList refuses Cloudflare's servers). Start now; it's remembered for 30 days.
  const aniListIdP = aniList.aniListIdFor(id);
  api(`/episode/${encodeURIComponent(`${id}:${guessEp}`)}/servers`).catch(() => {});

  // Fetch the latest progress from the account alongside the show, so another device's
  // episode and position are used (never waits more than a couple of seconds).
  const showP = api(`/anime/${id}`);
  const epsP = api(`/anime/${id}/episodes`);
  showP.then(() => step('Loading the episode list…'), () => {});
  epsP.then((d) => step(`Found ${d.episodes?.length || 0} episodes. Syncing your progress…`), () => {});
  const [a, epData] = await Promise.all([showP, epsP, store.sync.freshen()]);
  if (!alive()) return;
  document.title = `Watch ${a.title} · ${BRAND.title}`;
  store.rememberMeta(a);
  const episodes = epData.episodes;

  if (!episodes.length) {
    app.innerHTML = `<div class="empty"><h2>No episodes yet</h2><p>${esc(T(a))} ${IS_CINEMEE ? "isn't out yet" : "hasn't released any episodes"}.</p>
      <a class="btn" href="${animeHref(a)}">Back to details</a></div>`;
    return;
  }

  const settings = store.getSettings();
  const prog = store.getProgress(a.id);
  const wantEp = Number(query.get('ep')) || prog?.ep || 1;
  let current = episodes.find((e) => e.number === wantEp) || episodes[0];
  const missingEp = query.get('ep') && current.number !== wantEp ? wantEp : null;
  // ?t=754 from a "Share moment" link: start there (once).
  let sharedAt = /^\d{1,5}$/.test(query.get('t') || '') ? Number(query.get('t')) : null;
  // Watch party (see the party section below). partyAt: where a guest should start the next load.
  let party = null;
  let partyAt = null;
  let servers = [];
  let server = null; // { id, category }
  const watched = store.watchedSet(a.id);
  const CHUNK = 100;
  // The episode picker: cinemee TV shows with several seasons go season by season; long lists
  // otherwise go 100 at a time. Each group is a slice [from, to) of `episodes`.
  const bySeason = episodes.some((e) => e.season) && new Set(episodes.map((e) => e.season)).size > 1;
  const groups = [];
  if (bySeason) {
    episodes.forEach((e, i) => {
      const last = groups[groups.length - 1];
      if (last && last.season === e.season) last.to = i + 1;
      else groups.push({ season: e.season, from: i, to: i + 1 });
    });
    groups.forEach((g) => { g.label = `Season ${g.season} (${g.to - g.from})`; });
  } else if (episodes.length > CHUNK) {
    for (let from = 0; from < episodes.length; from += CHUNK) {
      const to = Math.min(from + CHUNK, episodes.length);
      groups.push({ from, to, label: `${from + 1}-${to}` });
    }
  }
  // Titles next to the numbers when the list (or each season) is short enough.
  const wide = (bySeason ? Math.max(...groups.map((g) => g.to - g.from)) <= 40 : episodes.length <= 30) && episodes.some((e) => e.title && !/^Episode \d+$/.test(e.title));
  const groupOf = (i) => Math.max(0, groups.findIndex((g) => i >= g.from && i < g.to));
  // Availability is determined by the configured providers for each episode.
  // Do not disable an episode based on MegaPlay-only availability when other servers exist.
  const playable = () => true;
  const fillerCount = episodes.filter((e) => e.isFiller).length;
  const recapCount = episodes.filter((e) => e.isRecap).length;

  app.innerHTML = `
    <div class="crumbs"><a href="/">Home</a> › <a href="${animeHref(a)}">${esc(T(a))}</a> › <span id="crumb-ep"></span></div>
    <div class="watch-grid${isMovie(a) ? ' is-movie' : ''}">
      <div>
        <div class="player-wrap">
          <div id="player"></div>
          <div class="pl-bar">
            <label><input type="checkbox" id="opt-autoplay" ${settings.autoplay ? 'checked' : ''}> Auto next</label>
            ${fillerCount || recapCount ? `<label title="Auto next skips filler and recap episodes"><input type="checkbox" id="opt-skipfiller" ${settings.skipFiller ? 'checked' : ''}> Skip filler</label>` : ''}
            <label class="anime-only" title="Skips intros and outros where the player knows them (3ellwa server)"><input type="checkbox" id="opt-autoskip" ${settings.autoskip ? 'checked' : ''}> Auto skip intro</label>
            <span class="card-meta player-hint">Pause, seek and quality controls are inside the player.<span class="keys-hint"> Keys: <kbd>N</kbd> next, <kbd>P</kbd> previous, <kbd>←</kbd><kbd>→</kbd> 10 s, <kbd>W</kbd> watched, <kbd>F</kbd> fullscreen.</span></span>
            <span class="spacer"></span>
            <button class="btn sm wide-btn" id="wide-toggle" type="button" aria-pressed="false">⤢ Wide player</button>
            <button class="btn sm" id="mark-seen" type="button">✓ Mark watched</button>
            ${IS_CINEMEE ? '<button class="btn sm" id="subs-btn" type="button" title="Use your own .srt or .vtt subtitle file (plays on the Atlas server)">CC Your subtitles</button><input type="file" id="subs-file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden>' : ''}
            <button class="btn sm" id="speed-btn" type="button" hidden title="Playback speed (remembered for this show)">1×</button>
            <button class="btn sm" id="party-btn" type="button" title="Watch together: friends with the link follow your episode and position">👥 Watch party</button>
            <button class="btn sm" id="share-moment" type="button" title="Copy a link that opens this episode at this moment">↗ Share moment</button>
            <details class="report-menu" id="report-menu">
              <summary class="btn sm">⚑ Report</summary>
              <div class="report-pop" role="group" aria-label="What's wrong with this episode?">
                <span class="card-meta">What's wrong?</span>
                <button class="btn sm" type="button" data-r="video">Video won't play</button>
                <button class="btn sm" type="button" data-r="wrong">Wrong episode</button>
                <button class="btn sm" type="button" data-r="subs">Subtitles missing or wrong</button>
                <button class="btn sm" type="button" data-r="audio">Audio problem</button>
                <button class="btn sm" type="button" data-r="other">Something else</button>
              </div>
            </details>
            <button class="btn sm" id="prev-ep">‹ Prev</button>
            <button class="btn sm next-glow" id="next-ep">Next ›</button>
          </div>
        </div>
        <div class="servers">
          <div class="now">You are watching<b id="now-ep"></b><span id="server-hint">If one server doesn't work, try another.</span></div>
          <div class="resume-note" id="resume-note" hidden></div>
          <div id="server-list"></div>
          <div class="not-working"><button class="btn sm" id="not-working" type="button">⚠ Not working? Try another server</button></div>
        </div>
        <section class="section">
          <div style="display:flex;gap:18px;align-items:flex-start">
            <img src="${esc(a.cover)}" alt="" style="width:110px;border-radius:10px">
            <div>
              <h2 style="margin:0 0 6px"><a href="${animeHref(a)}">${esc(T(a))}</a></h2>
              <div class="chips" style="margin:6px 0 10px">
                ${a.score ? `<span class="chip">★ ${score(a.score)}</span>` : ''}
                ${a.format ? `<span class="chip">${FORMAT[a.format]}</span>` : ''}
                <span class="chip">${STATUS[a.status] || ''}</span>
              </div>
              <div class="desc clamp">${esc(a.description || '')}</div>
              <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${listSelect(a)}${followButton(a, true)}</div>
            </div>
          </div>
        </section>
        <div id="watch-seasons"></div>
        <div id="watch-recs"></div>
      </div>
      <aside>
        <div class="ep-box">
          <div class="ep-head">
            <h3>Episodes <small class="card-meta">(${episodes.length})</small></h3>
            ${groups.length > 1 ? `<select id="ep-range" aria-label="${bySeason ? 'Season' : 'Episodes'}">${groups.map((g, i) => `<option value="${i}">${esc(g.label)}</option>`).join('')}</select>` : ''}
            <input class="input" id="ep-find" type="number" min="1" max="${episodes.length}" placeholder="EP #">
          </div>
          <div class="ep-list${wide ? ' wide' : ''}" id="ep-list"></div>
          ${fillerCount || recapCount ? `<div class="ep-legend">Filler guide: <span class="lg filler">${fillerCount} filler</span>${recapCount ? ` · <span class="lg recap">${recapCount} recap</span>` : ''} · <span class="lg canon">${episodes.length - fillerCount - recapCount} story</span></div>` : ''}
        </div>
      </aside>
    </div>`;

  bindListSelect(a);
  bindFollow(a, true);
  const $ = (sel) => document.getElementById(sel);
  const idx = () => episodes.indexOf(current);
  // Next episode for auto next: playable, and not filler or recap when "Skip filler" is on.
  const nextAuto = () => {
    const skip = store.getSettings().skipFiller;
    return episodes.slice(idx() + 1).find((e) => playable(e) && !(skip && (e.isFiller || e.isRecap))) || null;
  };

  // Keep the list status in step with what you actually watch:
  //  - playing a show that's on "Plan to watch" or "On hold" moves it to Watching;
  //  - finishing the last episode of a finished show marks it Completed.
  // Each change shows a note with Undo. Dropped / Not interested / Completed are never touched
  // by starting to watch, so rewatching a completed show leaves it alone.
  function autoStatus(why) {
    const status = store.getEntry(a.id)?.status || null;
    const last = episodes[episodes.length - 1];
    let next = null;
    if (why === 'ended' && a.status === 'FINISHED' && current === last && status !== 'completed') next = 'completed';
    else if (why === 'started' && (status === 'planning' || status === 'paused')) next = 'watching';
    if (!next) return;
    store.setEntry(a, next);
    const redraw = () => {
      const sel = document.getElementById('list-status');
      if (sel) { sel.outerHTML = listSelect(a); bindListSelect(a); }
    };
    redraw();
    const label = next === 'completed' ? 'Completed' : 'Watching';
    showNote(`Moved to <b>${label}</b> on your list. <button class="btn sm" type="button">Undo</button>`, () => {
      store.setEntry(a, status);
      redraw();
    });
  }

  const player = new Player($('player'), {
    autoskip: () => store.getSettings().autoskip,
    hasNext: () => !!nextAuto(),
    onNext: () => goTo(nextAuto()),
    onPause: () => store.sync.flush(),
    onAutoSkipPaused: () => showNote('Auto skip is paused for this episode because you went back. It turns on again for the next one.'),
    // MegaPlay resumed at the saved time: say so, with a way back to the beginning.
    onResumed: (at) => showNote(`Picked up where you stopped, at <b>${clock(at)}</b>. <button class="btn sm" type="button">Start over</button>`, () => player.seekTo(0)),
    onFail: (message) => tryNextServer(message),
    serverCount: () => new Set(servers.map((s) => s.id)).size,
    // Per show: speed and volume on our own player (Kaze), remembered in this browser.
    mediaPrefs: () => mediaPrefsFor(a.id),
    onReady: () => updateSpeedBtn(),
    onMediaPrefs: (p) => { saveMediaPrefs(a.id, p); updateSpeedBtn(); },
    onStarted: () => {
      countPlay(a.id);
      updateSpeedBtn();
      if (server) store.setGoodServer(a.id, server.category, server.id);
      // An episode counts as watched as soon as it starts playing (it gets its tick in the list,
      // Continue watching and New episodes move on), like tapping "Mark watched".
      if (!watched.has(current.number)) {
        store.markWatched(a.id, current.number);
        watched.add(current.number);
        showSeen();
        renderEpisodes();
      }
    },
    onEnded: () => {
      store.markWatched(a.id, current.number);
      watched.add(current.number);
      autoStatus('ended');
      store.sync.flush();
      const next = nextAuto();
      renderEpisodes();
      if (store.getSettings().autoplay && next) {
        const skipped = next.number - current.number - 1;
        player.upNext({
          title: `${epName(next)}${next.title && !/^Episode \d+$/.test(next.title) ? ` · ${next.title}` : ''}`,
          label: skipped > 0 ? `Skipping ${skipped} filler/recap episode${skipped > 1 ? 's' : ''}` : '',
          onGo: () => goTo(next),
        });
      }
    },
    onProgress: ({ time, duration, ep }) => {
      store.saveProgress({ animeId: a.id, ep, time, duration, title: a.title, cover: a.cover });
      if (time > 120) autoStatus('started');
      if (duration && time / duration > 0.85 && !watched.has(ep)) {
        store.markWatched(a.id, ep);
        watched.add(ep);
        showSeen();
      }
    },
  });
  onCleanup(() => { player.destroy(); store.sync.flush(); });

  // Picked up a newer position from another device while this page was open (e.g. the phone
  // was left on this page): offer to jump there rather than yanking the video around.
  const note = $('resume-note');
  const showNote = (html, onClick) => {
    note.innerHTML = html;
    note.hidden = !html;
    const b = note.querySelector('button');
    if (b) b.onclick = () => { note.hidden = true; onClick(); };
  };
  onCleanup(store.onSyncChange(({ pulled, changed }) => {
    if (!pulled || !changed?.has(String(a.id)) || !alive()) return;
    const p = store.getProgress(a.id);
    if (!p) return;
    const sameEp = p.ep === current.number;
    if (sameEp && Math.abs(p.time - player.getCurrentTime()) < 30) return;
    const target = episodes.find((e) => e.number === p.ep);
    if (!target) return;
    if (party) return; // in a watch party the host decides
    const where = `${isMovie(a) ? '' : `${esc(epName(target))} · `}${clock(p.time)}`;
    note.innerHTML = `📱 You're at <b>${where}</b> on another device. <button class="btn sm primary" type="button" data-go>Switch to it</button> <button class="btn sm" type="button" data-stay>Stay here</button>`;
    note.hidden = false;
    note.querySelector('[data-go]').onclick = () => { note.hidden = true; if (sameEp) playSource(p.time); else goTo(target); };
    note.querySelector('[data-stay]').onclick = () => { note.hidden = true; };
  }));
  // Both devices open at once: while this player sits idle (paused or not started), look for
  // progress from the other device every 45 seconds.
  let idleSince = player.getCurrentTime();
  const devicePoll = setInterval(() => {
    const t = player.getCurrentTime();
    const idle = Math.abs(t - idleSince) < 5;
    idleSince = t;
    if (idle && document.visibilityState === 'visible' && store.currentUser()) store.sync.freshen({ maxAge: 30000 });
  }, 45000);
  onCleanup(() => clearInterval(devicePoll));

  $('opt-autoplay').onchange = (e) => store.setSetting('autoplay', e.target.checked);
  $('opt-autoskip').onchange = (e) => { store.setSetting('autoskip', e.target.checked); player.setAutoSkip(e.target.checked); };
  // "Not working": note it for us, then move to the next server (or the other language).
  $('not-working').onclick = () => {
    report('video');
    if (!tryNextServer("That server didn't work for you.")) player.msg('No other server is left for this episode. Try again later.');
  };
  // Break reminder: after about 2 hours of actual watching (a 30-minute pause starts the count again).
  const BREAK_KEY = 'animee-space:break-off';
  let watchedFor = 0, lastSeen = player.getCurrentTime(), quietFor = 0;
  const breakTimer = setInterval(() => {
    let off = false;
    try { off = localStorage.getItem(BREAK_KEY) === '1'; } catch { /* ignore */ }
    if (off || document.visibilityState !== 'visible') return;
    const now = player.getCurrentTime();
    if (now !== lastSeen) { watchedFor += 30; quietFor = 0; } else if ((quietFor += 30) >= 1800) watchedFor = 0;
    lastSeen = now;
    if (watchedFor >= 7200) {
      watchedFor = 0;
      showNote('You have been watching for about 2 hours. Maybe stretch, drink some water ^^. <button class="btn sm" type="button">Stop these reminders</button>',
        () => { try { localStorage.setItem(BREAK_KEY, '1'); } catch { /* ignore */ } });
    }
  }, 30000);
  onCleanup(() => clearInterval(breakTimer));
  if ($('opt-skipfiller')) $('opt-skipfiller').onchange = (e) => store.setSetting('skipFiller', e.target.checked);
  const applyWide = (on) => {
    app.querySelector('.watch-grid').classList.toggle('wide', on);
    $('wide-toggle').setAttribute('aria-pressed', on);
    $('wide-toggle').textContent = on ? '⤡ Normal player' : '⤢ Wide player';
  };
  applyWide(!!store.getSettings().wide);
  $('wide-toggle').onclick = () => {
    const on = !store.getSettings().wide;
    store.setSetting('wide', on);
    applyWide(on);
  };
  loadExtras(a.id, alive, { recs: 'watch-recs' });
  loadSeasons(a, alive, 'watch-seasons', 'watch');
  const showSeen = () => {
    const seen = watched.has(current.number);
    $('mark-seen').disabled = seen;
    $('mark-seen').textContent = seen ? '✓ Watched' : '✓ Mark watched';
  };
  $('mark-seen').onclick = () => {
    store.markWatched(a.id, current.number);
    watched.add(current.number);
    showSeen();
    renderEpisodes();
  };
  $('prev-ep').onclick = () => idx() > 0 && goTo(episodes[idx() - 1]);
  // Shortcuts work while focus is on the page. Clicking into the embedded player gives it the
  // keyboard, so they pause until you click back outside it.
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    // ← / → jump 10 seconds (they never change the episode: people press → to skip intros).
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (player.seekBy(e.key === 'ArrowRight' ? 10 : -10)) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const actions = {
      n: () => $('next-ep').click(),
      p: () => $('prev-ep').click(),
      w: () => !$('mark-seen').disabled && $('mark-seen').click(),
      f: () => player.enterFullscreen(),
    };
    if (!actions[key]) return;
    e.preventDefault();
    actions[key]();
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));
  $('next-ep').onclick = () => idx() < episodes.length - 1 && goTo(episodes[idx() + 1]);
  // ---------- your own subtitles (cinemee, Atlas) ----------
  const SUBS_KEY = 'animee-space:custom-subs';
  const subsKey = () => `${a.id}:${current.number}`;
  function customSub() {
    try { return JSON.parse(sessionStorage.getItem(SUBS_KEY) || '{}')[subsKey()] || null; } catch { return null; }
  }
  if ($('subs-btn')) {
    $('subs-btn').onclick = () => $('subs-file').click();
    $('subs-file').onchange = async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 500 * 1024) { toastNote('That file is too big (500 KB at most).'); return; }
      try {
        const raw = await f.text();
        // SRT → WebVTT in the browser: timestamps get a dot, cue numbers go, a header is added.
        const t = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
        const vtt = /^WEBVTT/.test(t) ? `${t}\n` : `WEBVTT\n\n${t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/^\d+\n(?=\d{1,2}:\d{2}:\d{2}\.\d{3})/gm, '')}\n`;
        const r = await fetch('/api/subs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vtt }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        const label = f.name.replace(/\.(srt|vtt)$/i, '').slice(0, 40) || 'My subtitles';
        let all = {};
        try { all = JSON.parse(sessionStorage.getItem(SUBS_KEY) || '{}'); } catch { /* ignore */ }
        all[subsKey()] = { url: d.url, label };
        try { sessionStorage.setItem(SUBS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
        // Atlas is the server that takes subtitle files: switch to it and reload at the same spot.
        const atlas = servers.find((s) => s.id === 'embedmaster');
        if (!atlas) throw new Error('The Atlas server isn\u2019t available for this title.');
        server = { id: atlas.id, category: atlas.category };
        renderServers();
        toastNote(`Subtitles added (“${esc(label)}”). Playing on Atlas; pick them in its CC menu if they don’t show.`);
        playSource(player.getCurrentTime(), { explicit: true });
      } catch (err) { toastNote(esc(err.message)); }
    };
  }

  // Speed button (our own player only): 1× → 1.25× → 1.5× → 1.75× → 2× → 0.75× → 1×.
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function updateSpeedBtn() {
    const b = $('speed-btn');
    if (!b) return;
    b.hidden = !player.isNative();
    b.textContent = `${player.getRate()}×`;
  }
  $('speed-btn').onclick = () => {
    const now = player.getRate();
    const next = SPEEDS[(SPEEDS.indexOf(now) + 1) % SPEEDS.length] || 1;
    player.setRate(next);
    updateSpeedBtn();
  };
  $('share-moment').onclick = async () => {
    const t = Math.floor(player.getCurrentTime() || 0);
    const url = `${location.origin}/watch/${a.id}?ep=${current.number}${t > 5 ? `&t=${t}` : ''}`;
    const what = `${isMovie(a) ? a.title : `${a.title} · ${epName(current)}`}${t > 5 ? ` at ${clock(t)}` : ''}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ title: what, url }).catch(() => {});
    try {
      await navigator.clipboard.writeText(url);
      toastNote(`Link copied: ${esc(what)}.${t > 5 ? '' : ' (The player hasn’t said where it is, so it opens at the start.)'}`);
    } catch { prompt('Copy this link', url); }
  };

  let range = groupOf(idx());
  function renderEpisodes() {
    const slice = groups.length > 1 ? episodes.slice(groups[range].from, groups[range].to) : episodes;
    $('ep-list').innerHTML = slice.map((e) => `
      <button class="ep${e === current ? ' on' : ''}${watched.has(e.number) ? ' seen' : ''}${e.isFiller ? ' filler' : ''}${e.isRecap ? ' recap' : ''}${playable(e) ? '' : ' na'}"
        data-n="${e.number}" title="${e.label ? `${esc(e.label)}: ` : ''}${esc(e.title)}${e.isFiller ? ' (filler)' : e.isRecap ? ' (recap)' : ''}${playable(e) ? '' : ' (not available yet)'}">${wide ? `${e.label ? esc(e.label) : e.number}. ${esc(e.title)}` : e.label ? `S${e.season}E${e.episode}` : e.number}</button>`).join('');
    if ($('ep-range')) $('ep-range').value = String(range);
    // Scroll only the episode list, never the page, so the player stays in view on phones.
    const list = $('ep-list');
    const on = list.querySelector('.ep.on');
    if (on && list.scrollHeight > list.clientHeight) {
      const offset = on.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += offset - (list.clientHeight - on.offsetHeight) / 2;
    }
  }
  $('ep-list').onclick = (e) => {
    const b = e.target.closest('.ep');
    if (b) goTo(episodes.find((x) => x.number === Number(b.dataset.n)));
  };
  if ($('ep-range')) $('ep-range').onchange = (e) => { range = Number(e.target.value); renderEpisodes(); };
  $('ep-find').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const target = episodes.find((x) => x.number === Number(e.target.value));
    if (target) goTo(target);
  };

  function renderServers() {
    const groups = ['sub', 'dub'].map((cat) => {
      const list = servers.filter((s) => s.category === cat);
      if (!list.length) return '';
      return `<div class="srv-row"><span class="lab">${IS_CINEMEE ? 'play' : cat}</span><div class="srv-btns">${list.map((s) => `
        <button class="srv${server && server.id === s.id && server.category === cat ? ' on' : ''}" data-id="${esc(s.id)}" data-cat="${cat}"${playable(current, cat) ? (s.struggling ? ' title="Has had trouble with this episode lately"' : '') : ` disabled title="Not out in ${cat} for this episode yet"`}>${esc(s.name)}${s.struggling ? ' <span class="srv-warn" aria-label="has had trouble lately">!</span>' : ''}</button>`).join('')}</div></div>`;
    }).join('');
    $('server-list').innerHTML = groups || '<span class="card-meta">No servers available.</span>';
    // One server (cinemee): nothing to switch to, so no "try another" hint or button.
    const several = new Set(servers.map((s) => s.id)).size > 1;
    $('server-hint').hidden = !several;
    $('not-working').closest('.not-working').hidden = !several;
  }
  $('server-list').onclick = (e) => {
    const b = e.target.closest('.srv');
    if (!b) return;
    server = { id: b.dataset.id, category: b.dataset.cat };
    tried.delete(server.id);
    store.setShowCategory(a.id, server.category);
    store.setSetting('category', server.category);
    store.setSetting('provider', server.id);
    renderServers();
    playSource(player.getCurrentTime());
  };

  // Servers that already failed for this episode, so an automatic retry never loops.
  let tried = new Set();
  // explicit: ask for exactly this server (automatic retries), instead of "this one first".
  async function playSource(startAt, { explicit = false } = {}) {
    const ep = current;
    player.busy(explicit ? `Trying ${serverName(server)}…` : 'Loading episode…');
    try {
      const mode = explicit ? `server=${encodeURIComponent(server.id)}` : `server=auto&preferred=${encodeURIComponent(server.id)}`;
      // Wait briefly for the AniList ID; without it VidNest/TryEmbed are simply skipped by the fallback.
      const al = await Promise.race([aniListIdP, new Promise((r) => setTimeout(() => r(null), 2500))]);
      const src = await api(`/episode/${encodeURIComponent(ep.id)}/sources?${mode}&category=${server.category}${al ? `&al=${al}` : ''}`, { fresh: true });
      if (!alive() || ep !== current) return;
      if (!src.provider) src.provider = server.id;
      // Your own subtitle file for this episode goes to Atlas (EmbedMaster) as sub_url[] / sub_label[].
      const mySub = customSub();
      if (mySub && src.provider === 'embedmaster' && src.embedUrl) {
        const u = new URL(src.embedUrl);
        u.searchParams.append('sub_url[]', mySub.url);
        u.searchParams.append('sub_label[]', mySub.label);
        src.embedUrl = u.toString();
      }
      tried.add(src.provider);
      // Reflect the provider that actually resolved, not merely the first one tried.
      if (src.provider) {
        const resolved = servers.find((item) => item.id === src.provider && item.category === server.category);
        if (resolved) server = { id: resolved.id, category: resolved.category };
        renderServers();
      }
      player.load(src, { startAt, meta: { ep: ep.number } });
      updateSpeedBtn();
      // Embedded players can't be told where to start, so say where you left off.
      // A sticky note (missing episode, server switched) stays until the next episode.
      if (note.dataset.sticky) { /* keep it */ }
      else if (src.embedUrl && startAt > 15 && !['vidnest', 'tryembed', 'megaplay', 'vidnext', 'vidcore'].includes(src.provider)) showNote(`You stopped at <b>${clock(startAt)}</b>. Skip there in the player.`);
      else if (note.querySelector('button') === null) showNote('');
    } catch (err) {
      if (!alive() || ep !== current) return;
      tried.add(server.id);
      // Automatic mode already tried every server in this language on the Worker.
      if (!explicit) servers.filter((s) => s.category === server.category).forEach((s) => tried.add(s.id));
      if (!tryNextServer(`Couldn't load the video: ${err.message}`)) player.msg(`Couldn't load the video: ${err.message}`);
    }
  }
  // Tells the server which episode/server combination failed (no personal data is sent).
  const reported = new Set();
  function report(reason, srv = server) {
    if (!srv) return;
    const key = `${current.number}:${srv.id}:${srv.category}:${reason}`;
    if (reported.has(key)) return;
    reported.add(key);
    fetch('/api/report', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: a.id, ep: current.number, p: srv.id, c: srv.category, r: reason }),
    }).catch(() => {});
  }
  $('report-menu').onclick = (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    report(b.dataset.r);
    $('report-menu').open = false;
    $('report-menu').querySelector('summary').textContent = '✓ Reported, thanks';
  };
  const serverName = (s) => servers.find((x) => x.id === s?.id)?.name || s?.id || 'another server';

  // The video failed after it was handed to the player: move to the next server in the same
  // language once. Returns false when nothing is left, so the player shows the error.
  function tryNextServer(message) {
    if (!server || !alive()) return false;
    const failed = server;
    tried.add(failed.id);
    report('auto', failed);
    // Servers that keep failing on this episode lately (struggling) are tried last.
    const untried = (cat) => servers.filter((s) => s.category === cat && !tried.has(s.id))
      .sort((x, y) => Number(Boolean(x.struggling)) - Number(Boolean(y.struggling)))[0];
    let next = untried(failed.category);
    let switchedLanguage = false;
    // No sub server works: the dub beats a dead player (just for this episode; the choice isn't saved).
    if (!next && failed.category === 'sub') {
      next = untried('dub');
      switchedLanguage = Boolean(next);
    }
    if (!next) {
      player.msg(new Set(servers.map((s) => s.id)).size > 1
        ? `${message} No other ${failed.category} server could play it either. You can report it below.`
        : `${message} You can report it below.`);
      return true;
    }
    server = { id: next.id, category: next.category };
    renderServers();
    showNote(switchedLanguage
      ? 'The subtitled copy of this episode isn\'t playing right now, so we switched you to the <b>dub</b>.'
      : `${esc(serverName(failed))} didn't play, switched to <b>${esc(next.name)}</b>.`);
    note.dataset.sticky = '1'; // keep it up while the next server loads
    playSource(player.getCurrentTime(), { explicit: true });
    return true;
  }

  async function goTo(ep) {
    if (!ep) return;
    current = ep;
    range = groupOf(idx());
    history.replaceState(null, '', `/watch/${a.id}?ep=${ep.number}${party ? `&party=${party.code}` : ''}`);
    if (party?.role === 'host') setTimeout(sendPartyState, 800);
    $('crumb-ep').textContent = isMovie(a) ? 'Movie' : epName(ep);
    $('now-ep').textContent = isMovie(a) ? a.title : `${epName(ep)}${ep.isFiller ? ' (filler)' : ''}`;
    $('prev-ep').disabled = idx() === 0;
    $('next-ep').disabled = idx() === episodes.length - 1;
    store.addHistory({ animeId: a.id, ep: ep.number, title: a.title, cover: a.cover });
    showSeen();
    renderEpisodes();
    player.reset();
    tried = new Set();
    delete note.dataset.sticky;
    $('report-menu').querySelector('summary').textContent = '⚑ Report';
    player.busy('Finding a server…');
    $('server-list').innerHTML = '<span class="card-meta">Loading servers…</span>';
    try {
      const data = await api(`/episode/${encodeURIComponent(ep.id)}/servers`);
      if (!alive() || ep !== current) return;
      servers = data.servers;
      const prefs = store.getSettings();
      // This show's own sub/dub choice wins over the general setting.
      const pref = store.showCategory(a.id) || prefs.category;
      // The server that last played this show wins over the general preference.
      const preferredProvider = store.goodServer(a.id, pref) || prefs.provider || 'megaplay';
      // A server that keeps failing on this episode lately is skipped for the first try.
      const s = servers.find((x) => x.id === preferredProvider && x.category === pref && !x.struggling)
        || servers.find((x) => x.category === pref && !x.struggling)
        || servers.find((x) => x.category === pref)
        || servers[0];
      server = s ? { id: s.id, category: s.category } : null;
      renderServers();
      if (!server) return player.msg('No playback servers are configured for this episode.');
      if (s.category !== pref) $('now-ep').textContent += ` · ${pref} isn't out yet, playing ${s.category}`;
      const p = store.getProgress(a.id);
      // A shared moment (?t=seconds) wins once, on the episode it was shared from.
      const shared = partyAt ?? (sharedAt !== null && ep.number === wantEp ? sharedAt : null);
      sharedAt = null;
      partyAt = null;
      await playSource(shared ?? (p && p.ep === ep.number ? p.time : 0));
    } catch (err) {
      if (alive()) player.msg(`Couldn't load servers: ${err.message}`);
    }
  }

  // ---------- watch party ----------
  // The host's episode and position go to a small room on the server every few seconds; guests
  // follow (jumping where their server allows it). Reactions float over the player.
  const PARTY_KEY = (code) => `animee-space:party:${code}`;
  const partyBar = document.createElement('div');
  partyBar.className = 'party-bar';
  partyBar.hidden = true;
  document.querySelector('.player-wrap').appendChild(partyBar);
  // The bar is drawn once per party (so a half-typed message survives); updates change the info line.
  partyBar.innerHTML = `<div class="party-top"><span class="party-info"></span>
      <span class="party-react">${['😂', '😮', '❤️', '🔥', '😭', '👏'].map((e) => `<button type="button" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}</span>
      <span><button class="btn sm" type="button" data-invite>Copy invite</button> <button class="btn sm" type="button" data-leave>Leave</button></span></div>
    <div class="party-chat"><ol class="party-log" aria-live="polite" aria-label="Party chat"></ol>
      <form class="party-say"><input class="input" name="text" maxlength="200" autocomplete="off" placeholder="Say something to the party…" aria-label="Message the party"><button class="btn sm" type="submit">Send</button></form></div>`;
  // Your name in the chat: your username when signed in, otherwise a guest name kept for this tab.
  const chatName = () => {
    if (store.currentUser()?.name) return store.currentUser().name;
    let n = '';
    try { n = sessionStorage.getItem('animee-space:party-name') || ''; } catch { /* ignore */ }
    if (!n) { n = `Guest ${Math.floor(1000 + Math.random() * 9000)}`; try { sessionStorage.setItem('animee-space:party-name', n); } catch { /* ignore */ } }
    return n;
  };
  function addChatLine(name, text, { mine = false, host = false } = {}) {
    const log = partyBar.querySelector('.party-log');
    const li = document.createElement('li');
    li.className = mine ? 'mine' : '';
    li.innerHTML = `<b>${esc(name)}${host ? ' (host)' : ''}</b> ${esc(text)}`;
    log.appendChild(li);
    while (log.children.length > 50) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  partyBar.querySelector('.party-say').onsubmit = (e) => {
    e.preventDefault();
    const p = party;
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!p || !text || p.ws?.readyState !== 1) return;
    if (Date.now() - (p.lastSaid || 0) < 1000) return;
    p.lastSaid = Date.now();
    p.ws.send(JSON.stringify({ type: 'chat', name: chatName(), text }));
    addChatLine('You', text, { mine: true });
    input.value = '';
  };
  // Keys typed in the chat box (N, P, F, arrows…) stay in the chat box.
  partyBar.addEventListener('keydown', (e) => { if (e.target.matches('input')) e.stopPropagation(); });
  function renderPartyBar(extra = '') {
    const p = party;
    if (!p) { partyBar.hidden = true; $('party-btn').hidden = false; return; }
    $('party-btn').hidden = true;
    const live = p.ws?.readyState === 1;
    partyBar.hidden = false;
    partyBar.querySelector('.party-info').innerHTML = `👥 Party <b>${p.code}</b> · ${live ? `${p.people} watching` : 'connecting…'} · ${p.role === 'host' ? 'you’re the host: everyone follows you' : 'following the host'}${extra ? ` · ${extra}` : ''}`;
  }
  partyBar.onclick = async (e) => {
    const p = party;
    if (!p) return;
    const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
    if (emoji) { floatEmoji(emoji); if (p.ws?.readyState === 1) p.ws.send(JSON.stringify({ type: 'react', emoji })); return; }
    if (e.target.closest('[data-invite]')) {
      const url = `${location.origin}/watch/${a.id}?ep=${current.number}&party=${p.code}`;
      try { await navigator.clipboard.writeText(url); toastNote('Invite copied. Anyone with the link joins your party.'); } catch { prompt('Copy this invite', url); }
      return;
    }
    if (e.target.closest('[data-leave]')) leaveParty();
  };
  function floatEmoji(emoji) {
    const el = document.createElement('span');
    el.className = 'party-emoji';
    el.textContent = emoji;
    el.style.left = `${10 + Math.random() * 80}%`;
    document.querySelector('.player-wrap').appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
  function sendPartyState() {
    const p = party;
    if (!p || p.role !== 'host' || p.ws?.readyState !== 1) return;
    const t = player.getCurrentTime() || 0;
    const paused = player.isPausedHere();
    const playing = paused === null ? Math.abs(t - p.lastT) > 0.5 : !paused;
    p.lastT = t;
    p.ws.send(JSON.stringify({ type: 'state', show: a.id, ep: current.number, t, playing }));
  }
  function followHost(state) {
    const p = party;
    if (!p || !state) return;
    if (state.show !== String(a.id)) { go(`/watch/${state.show}?ep=${state.ep}&party=${p.code}`); return; }
    const expected = state.t + (state.playing ? Math.max(0, (Date.now() + (p.skew || 0) - state.at) / 1000) : 0);
    const target = episodes.find((x) => x.number === state.ep);
    if (target && target !== current) { partyAt = expected; goTo(target); return; }
    player.partyPause(!state.playing);
    const mine = player.getCurrentTime() || 0;
    if (Math.abs(expected - mine) <= 4) { if (p.behind) { p.behind = false; renderPartyBar(); } return; }
    if (player.canFollow()) { player.partySeek(expected); return; }
    // This server can't be moved from outside: say where the host is instead.
    p.behind = true;
    renderPartyBar(`host is at <b>${clock(expected)}</b>: skip there in the player`);
  }
  function connectParty() {
    const p = party;
    if (!p || p.closed) return;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/party/${p.code}/ws${p.hostKey ? `?host=${p.hostKey}` : ''}`);
    p.ws = ws;
    ws.onopen = () => { p.retry = 0; renderPartyBar(); };
    ws.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      if (d.now) p.skew = d.now - Date.now();
      if (d.type === 'hello') {
        p.role = d.role;
        p.people = d.people;
        renderPartyBar();
        if (p.role === 'host') sendPartyState(); else followHost(d.state);
      } else if (d.type === 'people') { p.people = d.people; renderPartyBar(); }
      else if (d.type === 'state' && p.role === 'guest') followHost(d.state);
      else if (d.type === 'react') floatEmoji(d.emoji);
      else if (d.type === 'chat') addChatLine(d.name, d.text, { host: d.host });
    };
    ws.onclose = () => {
      if (p.closed || party !== p) return;
      p.ws = null;
      renderPartyBar();
      p.retry = (p.retry || 0) + 1;
      setTimeout(connectParty, Math.min(15000, 1000 * 2 ** p.retry));
    };
  }
  function startParty(code, hostKey) {
    party = { code, hostKey: hostKey || '', role: hostKey ? 'host' : 'guest', people: 1, ws: null, lastT: 0, skew: 0, closed: false };
    renderPartyBar();
    connectParty();
  }
  function leaveParty() {
    if (!party) return;
    party.closed = true;
    try { party.ws?.close(); } catch { /* ignore */ }
    party = null;
    history.replaceState(null, '', `/watch/${a.id}?ep=${current.number}`);
    partyBar.querySelector('.party-log').innerHTML = '';
    renderPartyBar();
  }
  $('party-btn').onclick = async () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => letters[n % letters.length]).join('');
    const hostKey = crypto.randomUUID().replace(/-/g, '');
    try { sessionStorage.setItem(PARTY_KEY(code), hostKey); } catch { /* ignore */ }
    startParty(code, hostKey);
    history.replaceState(null, '', `/watch/${a.id}?ep=${current.number}&party=${code}`);
    const url = `${location.origin}/watch/${a.id}?ep=${current.number}&party=${code}`;
    try { await navigator.clipboard.writeText(url); toastNote('Party started, invite copied. Send it to your friends: they follow your episode and position.'); }
    catch { prompt('Send this invite to your friends', url); }
  };
  const partyTimer = setInterval(sendPartyState, 3000);
  let visibleFor = 0;
  const playCounter = setInterval(() => {
    if (document.visibilityState === 'visible') visibleFor += 15;
    if (visibleFor >= 90) { countPlay(a.id); clearInterval(playCounter); }
  }, 15000);
  onCleanup(() => clearInterval(playCounter));
  onCleanup(() => {
    clearInterval(partyTimer);
    if (party) { party.closed = true; try { party.ws?.close(); } catch { /* ignore */ } party = null; }
  });
  const joinCode = String(query.get('party') || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(joinCode)) {
    let key = '';
    try { key = sessionStorage.getItem(PARTY_KEY(joinCode)) || ''; } catch { /* ignore */ }
    startParty(joinCode, key);
  }

  goTo(current);
  // ?ep=999 on a 24-episode show: say so instead of silently playing another episode.
  if (missingEp) {
    showNote(`Episode ${esc(String(missingEp))} isn't out or doesn't exist, so this is Episode ${current.number}.`);
    note.dataset.sticky = '1';
  }
}

// ---------- new for you ----------
async function viewNew(alive) {
  document.title = `New episodes · ${BRAND.title}`;
  const draw = (items, checking) => {
    if (!alive()) return;
    const when = inbox.inboxCheckedAt();
    app.innerHTML = `
      <div class="section-head"><h2 class="hub-sub" style="margin:0">notifications</h2>
        <button class="btn sm" id="inbox-refresh" type="button"${checking ? ' disabled' : ''}>${checking ? 'Checking…' : '↻ Check now'}</button></div>
      <p class="card-meta">New episodes of airing shows on your <a href="/watchlist?tab=watching">Watching</a> list, after the last one you watched.
        ${when ? `Checked ${new Date(when).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
      ${items.length ? `<div class="inbox">${items.map((it) => `
        <div class="inbox-item">
          <a href="/watch/${esc(it.id)}?ep=${it.ep}"><img src="${esc(it.cover || '')}" alt="" loading="lazy"></a>
          <div class="inbox-body">
            <a class="inbox-title" href="/watch/${esc(it.id)}?ep=${it.ep}">${esc(it.title || 'Untitled')}</a>
            <span class="card-meta">Episode ${it.ep} is out${it.cat === 'dub' ? ' · dub' : ''}</span>
            <div class="actions"><a class="btn sm primary" href="/watch/${esc(it.id)}?ep=${it.ep}">▶ Watch episode ${it.ep}</a>
              <button class="btn sm" type="button" data-dismiss="${esc(it.id)}:${it.ep}">Dismiss</button></div>
          </div>
        </div>`).join('')}</div>`
        : `<div class="empty"><h2>${checking ? 'Checking your shows…' : 'All caught up ^^.'}</h2>
          <p>${checking ? '' : 'When an airing show on your Watching list gets a new episode, it shows up here.'}</p></div>`}`;
    addHub('alerts');
    document.getElementById('inbox-refresh').onclick = async () => {
      draw(inbox.inboxItems(), true);
      draw(await inbox.refreshInbox({ force: true }), false);
    };
    app.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => {
      const [id, ep] = b.dataset.dismiss.split(':');
      inbox.dismiss({ id, ep: Number(ep) });
      draw(inbox.inboxItems(), false);
    });
  };
  const stale = Date.now() - inbox.inboxCheckedAt() > 60 * 1000;
  draw(inbox.inboxItems(), stale);
  if (stale) draw(await inbox.refreshInbox({ force: true }), false);
}

// ---------- what's new ----------
// A small bar under the menu after an update, with the dated list one tap away. "Got it" hides it
// until the next update (per browser).
const NEWS = IS_CINEMEE ? [
  ['Nov 24', ['Rate anything 1-10, and see your ratings in Stats', 'Share your list with a link (Account)', 'Popular on cinemee this week', 'Chat in watch parties', 'Use your own .srt subtitles (CC button, Atlas server)']],
  ['Nov 23', ['Watch party: friends follow your episode and position, with reactions', 'Search finds titles even with typos, and remembers your recent searches', 'Weekly summary pop-ups (Settings)', 'Switch to where you are on your other device', 'My list, History and Stats open offline']],
  ['Nov 22', ['Seasons on TV pages, and season by season in the episode list', 'Hover a poster for its trailer', 'Share a moment: a link that opens at the exact minute', 'Continue on animee, right here', 'Real air times for TV', 'IMDb and Rotten Tomatoes scores', 'Search and remove items in History']],
  ['Nov 21', ['Welcome to cinemee: movies and TV, with the same lists, sync and pop-ups as animee', 'Up next stays in fullscreen', 'Save any title from its poster', 'Hide genres you skip']],
] : [
  ['Nov 24', ['Rate anything 1-10, and see your ratings in Stats', 'Share your list with a link (Account)', 'Popular on animee this week', 'Chat in watch parties', 'Kaze remembers speed and volume per show']],
  ['Nov 23', ['Watch party: friends follow your episode and position, with reactions', 'Search handles typos better and remembers your recent searches', 'Weekly summary pop-ups (Settings)', 'Switch to where you are on your other device', 'My list, History and Stats open offline']],
  ['Nov 22', ['Hover a poster for its trailer', 'Share a moment: a link that opens at the exact minute', 'Continue on cinemee, right here', 'Servers that keep failing on an episode are tried last', 'Search and remove items in History, with Undo']],
  ['Nov 21', ['Resume where you stopped on 3ellwa, with Start over', 'Auto skip intros and outros', 'Up next stays in fullscreen', 'Save any show from its poster', 'Select mode on My list', 'Hide genres you skip', '← → jump 10 seconds', 'Follow shows from the schedule', 'Picked for you on the home page']],
  ['Earlier', ['New-episode pop-ups', 'My Anime hub with Requests', 'Continue on any device', 'Short server names']],
];
const NEWS_VERSION = `${BRAND.name}-${NEWS[0][0]}`;
function showNews() {
  let seen = '';
  try { seen = localStorage.getItem('animee-space:news') || ''; } catch { /* ignore */ }
  if (seen === NEWS_VERSION || document.getElementById('news-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'news-bar';
  bar.className = 'news-bar';
  bar.innerHTML = `<span><b>New</b> on ${BRAND.name}, updated ${esc(NEWS[0][0])}</span>
    <button class="btn sm" type="button" data-news-open>See what's new</button>
    <button class="news-x" type="button" aria-label="Got it" data-news-ok>✕</button>`;
  document.querySelector('.nav')?.after(bar);
  const done = () => { try { localStorage.setItem('animee-space:news', NEWS_VERSION); } catch { /* ignore */ } bar.remove(); document.querySelector('.news-dlg')?.remove(); };
  bar.querySelector('[data-news-ok]').onclick = done;
  bar.querySelector('[data-news-open]').onclick = () => {
    const dlg = document.createElement('div');
    dlg.className = 'news-dlg';
    dlg.setAttribute('role', 'dialog');
    dlg.innerHTML = `<div class="news-card"><h2>what's new on ${BRAND.name}</h2>
      ${NEWS.map(([date, items]) => `<h3>${esc(date)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
      <p class="card-meta">Got an idea? Send it from <a href="/requests">Requests</a>.</p>
      <div class="actions"><button class="btn primary" type="button" data-news-ok>Got it</button></div></div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('[data-news-ok]').onclick = done;
    dlg.onclick = (e) => { if (e.target === dlg) dlg.remove(); };
  };
}

// ---------- my anime hub ----------
// One place for everything personal, like a dashboard: each tab is its own page, sharing this header.
const HUB_TABS = [
  ['me', '/me', 'Continue'],
  ['list', '/watchlist', 'My list'],
  ['favourites', '/watchlist?tab=favourites', '♥ Favourites'],
  ['history', '/watchlist?tab=history', 'History'],
  ['alerts', '/new', 'Notifications'],
  ['requests', '/requests', 'Requests'],
  ['stats', '/stats', 'Stats'],
  ['settings', '/settings', 'Settings'],
  ['account', '/account', 'Account'],
];
const HOW_KEY = 'animee-space:how-hidden';
function hubHead(active) {
  let hidden = false;
  try { hidden = localStorage.getItem(HOW_KEY) === '1'; } catch { /* ignore */ }
  const alerts = inbox.inboxItems().length;
  return `<div class="hub-head">
    <div class="hub-title"><div><h1 class="page-title" style="margin:0">${BRAND.hub}</h1>
      <p class="card-meta" style="margin:4px 0 0">Your list, your progress and your alerts. Saved in this browser, no sign-up; sign in to sync devices.</p></div>
      <button class="btn sm" type="button" id="how-toggle">${hidden ? 'ⓘ How it works' : 'Hide tips'}</button></div>
    <div class="how card-box" id="how"${hidden ? ' hidden' : ''}>
      <b>Five things to know</b>
      <ol>
        <li><b>Save</b> any show with <i>Add to list</i> on its page. Your list starts right then.</li>
        <li><b>Watch</b> as usual. Episodes you finish get a tick, and the show waits for you under <a href="/me">Continue</a>, at the exact second.</li>
        <li><b>Follow</b> an airing show with the 🔔 bell, and every new episode lands in <a href="/new">Notifications</a> (and as a pop-up, if you allow it in <a href="/settings#alerts">Settings</a>).</li>
        <li><b>Carry it over</b> with a free <a href="/account">account</a>: sign in on another phone or computer and the same list, progress and settings are there.</li>
        <li class="anime-only"><b>Bring an old list</b> from MyAnimeList or AniList in <a href="/settings#import">Settings</a>.</li>
      </ol>
    </div>
    <nav class="tabs hub-tabs" aria-label="${BRAND.hubNav}">${HUB_TABS.map(([k, href, label]) =>
      `<a class="tab${k === active ? ' on' : ''}" href="${href}">${label}${k === 'alerts' && alerts ? ` <small class="hub-dot">${alerts}</small>` : ''}</a>`).join('')}</nav>
  </div>`;
}
// Puts the hub header at the top of the current page (views call this after drawing).
function addHub(active) {
  app.querySelector('.hub-head')?.remove();
  app.insertAdjacentHTML('afterbegin', hubHead(active));
  document.getElementById('how-toggle').onclick = () => {
    const box = document.getElementById('how');
    box.hidden = !box.hidden;
    try { localStorage.setItem(HOW_KEY, box.hidden ? '1' : '0'); } catch { /* ignore */ }
    document.getElementById('how-toggle').textContent = box.hidden ? 'ⓘ How it works' : 'Hide tips';
  };
}

// Continue tab: everything in progress, newest first, with remove buttons.
function viewMe() {
  document.title = `${BRAND.hubNav} · ${BRAND.title}`;
  const cont = store.continueList().filter((p) => p.title);
  app.innerHTML = `<h2 class="hub-sub">continue watching</h2>
    ${cont.length ? `<div class="cont-grid">${cont.map(contCard).join('')}</div>`
      : '<div class="empty"><p>Nothing here yet. Play any episode and it waits for you here, at the exact episode and second.</p><a class="btn" href="/">Find something to watch</a></div>'}`;
  addHub('me');
  app.querySelectorAll('.cont .x').forEach((b) => b.onclick = (e) => {
    e.preventDefault();
    store.removeProgress(b.dataset.id);
    b.closest('.cont').remove();
  });
  checkNewEpisodes(cont, () => parseHash().parts[0] === 'me');
}

// ---------- requests ----------
// A random id made once per browser, so answers come back here without an account.
function requesterId() {
  const key = 'animee-space:who';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      id = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => abc[b & 63]).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch { return null; }
}
const KIND_LABEL = { anime: IS_CINEMEE ? 'A movie or show you want added' : 'An anime you want added', idea: 'An idea for the site', broken: 'Something is broken', other: 'Something else' };
const fmtWhen = (sec) => new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
async function viewRequests(alive) {
  document.title = `Requests · ${BRAND.title}`;
  const who = requesterId();
  app.innerHTML = `<h2 class="hub-sub">ask us something</h2>
    <p class="card-meta">A missing anime, an idea or a problem: we read every message, and the answer shows up right here.</p>
    <form class="req-form card-box" id="req-form">
      <fieldset class="chips"><legend class="card-meta">It is about</legend>
        ${Object.entries(KIND_LABEL).map(([k, l], i) => `<label class="chip check"><input type="radio" name="kind" value="${k}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}
      </fieldset>
      <label class="field" id="req-anime-field"><span>${IS_CINEMEE ? 'Title' : 'Anime name'}</span><input class="input" name="anime" maxlength="120" autocomplete="off"></label>
      <label class="field"><span>Message</span><textarea class="input" name="message" rows="4" maxlength="1000" placeholder="Anything that helps: season, episode, what went wrong…"></textarea></label>
      <div class="actions"><button class="btn primary" type="submit">Send</button><span class="card-meta" id="req-status" role="status"></span></div>
    </form>
    <h2 class="hub-sub" style="margin-top:26px">your messages</h2>
    <div id="req-list">${loader()}</div>`;
  addHub('requests');
  const form = document.getElementById('req-form');
  const animeField = document.getElementById('req-anime-field');
  const syncKind = () => { animeField.hidden = form.elements.kind.value !== 'anime'; };
  form.querySelectorAll('input[name=kind]').forEach((r) => r.onchange = syncKind);
  syncKind();

  const drawList = async () => {
    const box = document.getElementById('req-list');
    if (!box) return;
    if (!who) { box.innerHTML = '<p class="card-meta">Your browser is blocking storage, so answers can\'t be shown here.</p>'; return; }
    try {
      const r = await fetch('/api/requests?who=' + encodeURIComponent(who), { credentials: 'same-origin' });
      const { requests = [], error } = await r.json();
      if (!alive()) return;
      if (error) throw new Error(error);
      box.innerHTML = requests.length ? requests.map((q) => `
        <div class="req-item card-box">
          <div class="card-meta">${esc(KIND_LABEL[q.kind] || q.kind)} · ${fmtWhen(q.created)}${q.anime ? ` · <b>${esc(q.anime)}</b>` : ''}</div>
          <p>${esc(q.message)}</p>
          ${q.answer ? `<div class="req-answer"><span class="card-meta">Our answer · ${fmtWhen(q.answered)}</span><p>${esc(q.answer)}</p></div>`
            : '<span class="card-meta">Waiting for an answer.</span>'}
        </div>`).join('') : '<p class="card-meta">Nothing sent yet.</p>';
    } catch (err) {
      box.innerHTML = `<p class="card-meta">Couldn't load your messages: ${esc(err.message)}</p>`;
    }
  };
  drawList();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const status = document.getElementById('req-status');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.textContent = 'Sending…';
    try {
      const r = await fetch('/api/requests', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ who, kind: form.elements.kind.value, anime: form.elements.anime.value, message: form.elements.message.value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Sending failed');
      form.reset();
      syncKind();
      status.textContent = 'Sent, thanks! The answer will show up below.';
      drawList();
    } catch (err) {
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
}

// ---------- admin (hidden; needs the ADMIN_KEY secret) ----------
function viewAdmin() {
  document.title = `Admin · ${BRAND.title}`;
  const KEY = 'animee-space:admin-key';
  const getKey = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
  const forget = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
  const call = async (path, body) => {
    const r = await fetch('/api/admin/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Admin-Key': getKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Failed (${r.status})`), { status: r.status });
    return d;
  };
  const askKey = (message = '') => {
    app.innerHTML = `<div class="auth-box"><h1 class="page-title" style="margin-top:0">admin</h1>
      <form id="admin-login"><label class="field"><span>Admin key</span><input class="input" type="password" name="key" autocomplete="off" required></label>
      <div class="actions"><button class="btn primary">Open</button></div><p class="card-meta">${esc(message)}</p></form></div>`;
    document.getElementById('admin-login').onsubmit = (e) => {
      e.preventDefault();
      try { sessionStorage.setItem(KEY, e.target.elements.key.value); } catch { /* ignore */ }
      load();
    };
  };
  const REASONS = ['auto switch', 'won\'t play', 'wrong episode', 'subtitles', 'audio', 'other'];
  const load = async () => {
    if (!getKey()) return askKey();
    app.innerHTML = loader();
    let data;
    try { data = await call('requests'); } catch (err) {
      if (err.status === 401 || err.status === 429) forget();
      return askKey(err.message);
    }
    const open = data.requests.filter((r) => !r.answer).length;
    app.innerHTML = `<h1 class="page-title">admin</h1>
      <p class="card-meta">${open} open request${open === 1 ? '' : 's'} · ${data.requests.length} shown. <button class="link-btn" id="admin-out" type="button">Forget key</button></p>
      <section class="section"><div class="section-head"><h2>site notice</h2></div>
        <form class="card-box" id="notice-form">
          <p class="card-meta">A banner on every page of ${esc(BRAND.title)} until it expires or the visitor closes it. Leave the text empty and save to remove it.${data.notice ? ` <b>Showing now${data.notice.until ? `, until ${new Date(data.notice.until * 1000).toLocaleString()}` : ''}.</b>` : ' Nothing is showing.'}</p>
          <label class="field"><span>Text</span><textarea class="input" name="text" rows="2" maxlength="280" placeholder="e.g. Server 3ellwa is having trouble tonight, use JoJo.">${esc(data.notice?.text || '')}</textarea></label>
          <div class="filter-row">
            <label class="field"><span>Style</span><select class="input" name="level"><option value="info">Info</option><option value="warn"${data.notice?.level === 'warn' ? ' selected' : ''}>Warning</option></select></label>
            <label class="field"><span>Link (optional)</span><input class="input" name="link" placeholder="/requests or https://…" value="${esc(data.notice?.link || '')}"></label>
            <label class="field"><span>Hide after (hours, empty = never)</span><input class="input" name="hours" type="number" min="0" step="1" inputmode="numeric"></label>
          </div>
          <div class="actions"><button class="btn sm primary" type="submit">Save notice</button><span class="card-meta" data-out></span></div>
        </form></section>
      <section class="section"><div class="section-head"><h2>playback reports (7 days)</h2></div>
        ${data.reports.length ? `<table class="admin-table"><tr><th>Server</th><th>Audio</th><th>Reason</th><th>Count</th></tr>
          ${data.reports.map((r) => `<tr><td>${esc(r.provider)}</td><td>${r.cat ? 'dub' : 'sub'}</td><td>${REASONS[r.reason] || r.reason}</td><td>${r.n}</td></tr>`).join('')}</table>`
          : '<p class="card-meta">No reports in the last 7 days.</p>'}</section>
      <section class="section"><div class="section-head"><h2>servers tried last right now</h2></div>
        <p class="card-meta">From the reports: 2+ on one episode in 3 days, or 3+ episodes of a show within 2 days. Clear a false alarm and that server goes back to its normal place (within 10 minutes everywhere).</p>
        ${data.demoted?.length ? `<table class="admin-table" id="demoted"><tr><th>Title</th><th>Where</th><th>Server</th><th>Reports</th><th></th></tr>
          ${data.demoted.map((d) => `<tr data-anime="${esc(d.anime)}" data-ep="${d.ep ?? ''}" data-provider="${esc(d.provider)}" data-category="${esc(d.category)}">
            <td><a href="/anime/${esc(d.anime)}" data-title="${esc(d.anime)}">#${esc(d.anime)}</a></td><td>${d.ep ? `episode ${d.ep}` : '<b>whole show</b>'}</td>
            <td>${esc(d.provider)} ${esc(d.category)}</td><td>${d.n}</td><td><button class="btn sm" type="button" data-clear>Clear</button></td></tr>`).join('')}</table>`
          : '<p class="card-meta">Nothing is demoted right now.</p>'}</section>
      <section class="section"><div class="section-head"><h2>errors (7 days)</h2></div>
        <p class="card-meta">API answers that failed (5xx, per route) and pages that crashed in visitors' browsers, per day.</p>
        ${data.errors?.length ? `<table class="admin-table"><tr><th>Day</th><th>Kind</th><th>Where</th><th>Count</th></tr>
          ${data.errors.map((e) => `<tr><td>${new Date(e.day * 86400000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${esc(e.kind)}</td><td>${esc(e.place)}</td><td>${e.n}</td></tr>`).join('')}</table>`
          : '<p class="card-meta">No errors in the last 7 days.</p>'}</section>
      <section class="section"><div class="section-head"><h2>requests</h2></div>
        ${data.requests.map((q) => `<div class="req-item card-box" data-id="${q.id}">
          <div class="card-meta">#${q.id} · ${esc(KIND_LABEL[q.kind] || q.kind)} · ${fmtWhen(q.created)}${q.anime ? ` · <b>${esc(q.anime)}</b>` : ''}</div>
          <p>${esc(q.message)}</p>
          <textarea class="input" rows="2" maxlength="2000" placeholder="Your answer (shown to them)">${esc(q.answer || '')}</textarea>
          <div class="actions"><button class="btn sm primary" data-act="answer" type="button">${q.answer ? 'Update answer' : 'Send answer'}</button>
            <button class="btn sm" data-act="delete" type="button">Delete</button><span class="card-meta" data-out></span></div>
        </div>`).join('') || '<p class="card-meta">No requests yet.</p>'}</section>`;
    document.getElementById('admin-out').onclick = () => { forget(); askKey(); };
    // Titles for the demoted list, six at a time.
    const titleIds = [...new Set((data.demoted || []).map((d) => d.anime))];
    for (let i = 0; i < titleIds.length; i += 6) {
      api(`/batch?ids=${titleIds.slice(i, i + 6).join(',')}`).then(({ results }) => {
        for (const t of results || []) app.querySelectorAll(`[data-title="${t.id}"]`).forEach((el) => { el.textContent = T(t); });
      }).catch(() => {});
    }
    app.querySelectorAll('#demoted [data-clear]').forEach((b) => b.onclick = async () => {
      const row = b.closest('tr');
      const { anime, ep, provider, category } = row.dataset;
      b.disabled = true;
      try {
        await call('undemote', { anime, ep: ep ? Number(ep) : null, provider, category });
        row.remove();
      } catch (err) { b.disabled = false; b.textContent = err.message; }
    });
    document.getElementById('notice-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const out = e.target.querySelector('[data-out]');
      try {
        const { notice } = await call('notice', { text: f.text.value, level: f.level.value, link: f.link.value, hours: f.hours.value ? Number(f.hours.value) : null });
        out.textContent = notice ? 'Saved ✓ (visitors see it within a minute)' : 'Removed ✓';
      } catch (err) { out.textContent = err.message; }
    };
    app.querySelectorAll('.req-item [data-act]').forEach((b) => b.onclick = async () => {
      const item = b.closest('.req-item');
      const id = Number(item.dataset.id);
      const out = item.querySelector('[data-out]');
      try {
        if (b.dataset.act === 'delete') {
          if (!confirm('Delete this request?')) return;
          await call('delete', { id });
          item.remove();
        } else {
          await call('answer', { id, answer: item.querySelector('textarea').value });
          out.textContent = 'Saved ✓';
        }
      } catch (err) { out.textContent = err.message; }
    });
  };
  load();
}

// Speed and volume per show on our own player, this browser only (the last 200 shows).
const MEDIA_KEY = 'animee-space:media-prefs';
function mediaPrefsFor(id) {
  try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}')[id] || null; } catch { return null; }
}
function saveMediaPrefs(id, p) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(MEDIA_KEY) || '{}'); } catch { /* ignore */ }
  delete all[id];
  all[id] = { rate: p.rate, volume: p.volume, muted: p.muted };
  const keys = Object.keys(all);
  if (keys.length > 200) keys.slice(0, keys.length - 200).forEach((k) => delete all[k]);
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

// "Popular here": one anonymous count per show per day from this browser (see popular.js).
function countPlay(id) {
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

// ---------- a shared list (/u/<name>) ----------
async function viewShared(name, alive, query) {
  const d = await api(`/u/${encodeURIComponent(String(name || ''))}`).catch((err) => ({ error: err.message }));
  if (!alive()) return;
  if (d.error || !d.items) {
    app.innerHTML = `<div class="empty"><h2>This list isn't shared</h2><p>It's private, or there's no one by that name.</p><a class="btn primary" href="/">Go home</a></div>`;
    return;
  }
  document.title = `${d.name}'s list · ${BRAND.title}`;
  const tab = query.get('tab') || 'all';
  const tabs = [['all', 'All'], ...store.LIST_STATUSES.filter(([k]) => k !== 'notinterested'), ['favourites', '♥ Favourites']]
    .filter(([k]) => k === 'all' || d.items.some((i) => (k === 'favourites' ? i.favourite : i.status === k)));
  const shown = d.items.filter((i) => (tab === 'all' ? true : tab === 'favourites' ? i.favourite : i.status === tab));
  const label = Object.fromEntries(store.LIST_STATUSES);
  app.innerHTML = `<h1 class="page-title">${esc(d.name)}'s ${d.mode === 'favourites' ? 'favourites' : 'list'}</h1>
    <p class="card-meta">${d.total} title${d.total === 1 ? '' : 's'}${d.total > d.items.length ? ` (${d.items.length} shown)` : ''} · shared from ${esc(BRAND.title)}. <a href="/account">Share yours</a></p>
    ${d.mode === 'all' && tabs.length > 2 ? `<div class="tabs">${tabs.map(([k, l]) => `<a class="tab${k === tab ? ' on' : ''}" href="/u/${esc(d.name)}${k === 'all' ? '' : `?tab=${k}`}">${l}</a>`).join('')}</div>` : ''}
    ${shown.length ? `<div class="grid">${shown.map((i) => card(i).replace('<div class="card-meta">', `<div class="card-meta">${[i.status ? label[i.status] : '', i.favourite ? '♥' : '', i.rating ? `★ ${i.rating}/10 from ${esc(d.name)}` : ''].filter(Boolean).join(' · ')}${i.status || i.favourite || i.rating ? ' · ' : ''}`)).join('')}</div>`
      : '<div class="empty"><p>Nothing here.</p></div>'}`;
}

// ---------- stats ----------
// Your ratings: how many, the average, how they spread, and the genres you rate highest.
function ratingStats() {
  const rated = store.ratedList();
  if (!rated.length) return '<section class="section"><div class="section-head"><h2>your ratings</h2></div><p class="card-meta">Rate shows from their page or the ＋ on any poster, and your ratings show up here.</p></section>';
  const avg = rated.reduce((n, r) => n + r.rating, 0) / rated.length;
  const spread = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => [n, rated.filter((r) => r.rating === n).length]);
  const most = Math.max(1, ...spread.map(([, c]) => c));
  const byGenre = new Map();
  for (const r of rated) for (const g of r.genres || []) { const x = byGenre.get(g) || [0, 0]; byGenre.set(g, [x[0] + r.rating, x[1] + 1]); }
  const loved = [...byGenre].filter(([, [, c]]) => c >= 2).map(([g, [t, c]]) => [g, t / c]).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const best = rated.slice().sort((x, y) => y.rating - x.rating).slice(0, 6);
  return `<section class="section"><div class="section-head"><h2>your ratings</h2></div>
    <p class="card-meta"><b>${rated.length}</b> rated · average <b>${avg.toFixed(1)}</b>/10${loved.length ? ` · you rate <b>${loved.map(([g]) => esc(g)).join(', ')}</b> highest` : ''}</p>
    <div class="bars">${spread.map(([n, c]) => `<div class="bar-row"><span>★ ${n}</span><div class="bar"><i style="width:${Math.round((c / most) * 100)}%"></i></div><b>${c}</b></div>`).join('')}</div>
    ${best.some((r) => r.title) ? `<div class="grid" style="margin-top:14px">${best.filter((r) => r.title).map((r) => `<a class="card" href="/anime/${esc(r.id)}"><div class="poster"><img loading="lazy" src="${esc(r.cover || '')}" alt=""><span class="badge mine">you ${r.rating}/10</span></div><div class="card-title">${esc(r.title)}</div></a>`).join('')}</div>` : ''}
  </section>`;
}
// Everything is worked out from what this browser knows (your library, plus history opened here).
function viewStats() {
  document.title = `My stats · ${BRAND.title}`;
  const rows = store.libraryRows();
  const history = store.getHistory();
  const episodes = rows.reduce((n, r) => n + r.watched, 0);
  const minutes = rows.reduce((n, r) => n + r.watched * (r.duration || 24), 0);
  const count = (k) => rows.filter((r) => r.status === k).length;
  const fmtHours = (m) => (m >= 1440 ? `${(m / 1440).toFixed(1)} days` : `${Math.round(m / 60)} hours`);

  // Genres, weighted by episodes watched.
  const genreMin = new Map();
  for (const r of rows) for (const g of r.genres || []) genreMin.set(g, (genreMin.get(g) || 0) + r.watched);
  const genres = [...genreMin].filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const topGenre = genres[0]?.[1] || 1;
  const missingGenres = rows.filter((r) => r.watched && !r.genres).length;

  const top = rows.filter((r) => r.watched && r.title).sort((x, y) => y.watched - x.watched).slice(0, 6);

  // Activity from history (this browser only): busiest weekday, longest streak, this year.
  const days = new Set(history.map((h) => new Date(h.at).toDateString()));
  let streak = 0, best = 0, prev = null;
  for (const d of [...days].map((x) => new Date(x)).sort((x, y) => x - y)) {
    streak = prev && (d - prev) / 86400e3 === 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
    prev = d;
  }
  const weekdays = Array(7).fill(0);
  history.forEach((h) => weekdays[new Date(h.at).getDay()]++);
  const maxDay = Math.max(1, ...weekdays);
  const dayNames = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'short' }));
  const year = new Date().getFullYear();
  const thisYear = history.filter((h) => new Date(h.at).getFullYear() === year).length;

  const summary = `My ${IS_CINEMEE ? 'movie and TV' : 'anime'} stats on ${BRAND.name}: ${episodes} episodes watched (${fmtHours(minutes)}), ${count('completed')} shows completed${genres[0] ? `, favourite genre ${genres[0][0]}` : ''}.`;

  app.innerHTML = `
    <h2 class="hub-sub">my stats</h2>
    ${!rows.length ? `<div class="empty"><h2>Nothing yet ^^.</h2><p>Watch something and your stats start here.</p><a class="btn primary" href="/">Find something to watch</a></div>` : `
    <div class="stats stat-grid">
      <div><b>${episodes}</b><span>episodes watched</span></div>
      <div><b>${fmtHours(minutes)}</b><span>${IS_CINEMEE ? 'of watching' : 'of anime'} (about)</span></div>
      <div><b>${count('completed')}</b><span>completed</span></div>
      <div><b>${count('watching')}</b><span>watching</span></div>
      <div><b>${count('planning')}</b><span>plan to watch</span></div>
      <div><b>${rows.filter((r) => r.favourite).length}</b><span>favourites</span></div>
    </div>
    ${ratingStats()}
    ${genres.length ? `<section class="section"><div class="section-head"><h2>top genres</h2></div>
      <div class="bars">${genres.map(([g, n]) => `<div class="bar-row"><span>${esc(g)}</span><div class="bar"><i style="width:${Math.round((n / topGenre) * 100)}%"></i></div><b>${n}</b></div>`).join('')}</div>
      <p class="card-meta">Weighted by episodes watched.${missingGenres ? ` Loading genres for ${missingGenres} more show${missingGenres > 1 ? 's' : ''}…` : ''}</p></section>`
      : missingGenres ? '<p class="card-meta">Loading genres…</p>' : ''}
    ${top.length ? `<section class="section"><div class="section-head"><h2>most watched</h2></div>
      <div class="grid">${top.map((r) => `<a class="card" href="/anime/${esc(r.id)}"><div class="poster"><img loading="lazy" src="${esc(r.cover || '')}" alt=""><span class="badge eps">${r.watched} eps</span></div><div class="card-title">${esc(r.title)}</div></a>`).join('')}</div></section>` : ''}
    ${history.length ? `<section class="section"><div class="section-head"><h2>when you watch</h2></div>
      <div class="week">${weekdays.map((n, i) => `<div class="week-col" title="${n} episodes opened"><i style="height:${Math.round((n / maxDay) * 100)}%"></i><span>${dayNames[i]}</span></div>`).join('')}</div>
      <p class="card-meta">Longest streak: <b>${best} day${best === 1 ? '' : 's'}</b> in a row · ${thisYear} episodes opened in ${year}. Based on history in this browser.</p></section>` : ''}
    <div class="actions" style="margin-top:22px"><button class="btn" id="stats-copy" type="button">Copy a summary to share</button></div>`}`;

  addHub('stats');
  const copy = document.getElementById('stats-copy');
  if (copy) copy.onclick = async () => {
    try { await navigator.clipboard.writeText(summary); copy.textContent = 'Copied ✓'; } catch { copy.textContent = summary; }
  };
  // Older library entries have no genres saved: fetch them (6 at a time) and redraw once.
  const need = rows.filter((r) => r.watched && !r.genres).sort((x, y) => y.watched - x.watched).slice(0, 30).map((r) => r.id);
  if (need.length && !viewStats.filling) {
    viewStats.filling = true;
    (async () => {
      for (let i = 0; i < need.length; i += 6) {
        try { (await api('/batch?ids=' + need.slice(i, i + 6).join(','))).results.forEach((a) => store.rememberMeta(a)); } catch { /* skip */ }
      }
      viewStats.filling = false;
      if (parseHash().parts[0] === 'stats') viewStats();
    })();
  }
}

// ---------- watchlist ----------
// Long lists (for example after an import) are shown 60 at a time.
const LIST_PAGE = 60;
const asCard = (e) => ({ ...e, availableEpisodes: e.episodes });
const LIST_SORTS = [['recent', 'Last changed first'], ['oldest', 'First changed first'], ['title', 'Title A-Z'], ['year', 'Newest year'], ['rating', 'My rating']];
function viewWatchlist(query) {
  document.title = `Watchlist · ${BRAND.title}`;
  const ids = Object.keys(store.getList());
  store.ensureMeta(ids).then((changed) => { if (changed && parseHash().parts[0] === 'watchlist') route(); });
  const list = Object.values(store.getList()).filter((e) => e.title);
  const tab = query.get('tab') || 'all';
  const count = (k) => list.filter((e) => e.status === k).length;
  const inAll = (e) => e.status && e.status !== 'notinterested';
  const favCount = list.filter((e) => e.favourite).length;
  const opened = store.getHistory();
  const tabs = `<div class="tabs list-status-tabs">
      <a class="tab${tab === 'all' ? ' on' : ''}" href="/watchlist">All <small>${list.filter(inAll).length}</small></a>
      ${store.LIST_STATUSES.map(([k, l]) => `<a class="tab${tab === k ? ' on' : ''}" href="/watchlist?tab=${k}">${l} <small>${count(k)}</small></a>`).join('')}
      <a class="tab${tab === 'favourites' ? ' on' : ''}" href="/watchlist?tab=favourites">♥ Favourites <small>${favCount}</small></a>
      <a class="tab${tab === 'history' ? ' on' : ''}" href="/watchlist?tab=history">History <small>${opened.length}</small></a>
    </div>`;
  const signInNote = !store.currentUser() ? '<p class="card-meta" style="text-align:center;margin-top:24px"><a href="/account" style="color:var(--accent)">Sign in</a> to sync your list across devices.</p>' : '';

  if (tab === 'history') {
    // Grouped by day, searchable; each row (or the whole history) can be removed, with Undo.
    const hq = (query.get('q') || '').trim().toLowerCase();
    const shownHistory = hq ? opened.filter((h) => String(h.title || '').toLowerCase().includes(hq)) : opened;
    const dayLabel = (at) => {
      const d = new Date(at); const today = new Date();
      const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 86400e3);
      return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
    };
    const groups = [];
    for (const h of shownHistory) {
      const label = dayLabel(h.at);
      if (groups[groups.length - 1]?.label !== label) groups.push({ label, items: [] });
      groups[groups.length - 1].items.push(h);
    }
    const epText = (h) => (IS_CINEMEE && String(h.animeId).endsWith('1') ? 'Movie' : `Episode ${h.ep}`);
    app.innerHTML = `<h2 class="hub-sub">watch history</h2>
      <p class="card-meta">Every episode you opened in this browser, newest first. History stays on this device.</p>
      ${opened.length ? `<form class="filter-row" id="hist-find"><input class="input" type="search" name="q" value="${esc(hq)}" placeholder="Search your history…" aria-label="Search your history"></form>
        ${groups.length ? groups.map((g) => `<h3 class="hist-day">${esc(g.label)}</h3><div class="sched">${g.items.map((h) => `
        <div class="hist-row">
          <a class="sched-row" href="/watch/${h.animeId}?ep=${h.ep}">
            <img src="${esc(h.cover)}" alt="${esc(h.title)} poster" loading="lazy">
            <span class="sched-info"><span class="t">${esc(h.title)}</span>
              <span class="card-meta">${epText(h)} · ${new Date(h.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></span>
          </a>
          <button class="hist-x" type="button" data-id="${esc(h.animeId)}" data-ep="${h.ep}" aria-label="Remove ${esc(h.title)} ${epText(h)} from history" title="Remove from history">✕</button>
        </div>`).join('')}</div>`).join('') : `<p class="card-meta">Nothing in your history matches “${esc(hq)}”.</p>`}
        <p style="margin-top:16px"><button class="link-btn" id="clear-history" type="button">Clear history</button></p>`
        : '<div class="empty"><h2>No history yet</h2><p>Episodes you open show up here.</p></div>'}`;
    const find = document.getElementById('hist-find');
    if (find) {
      find.onsubmit = (e) => e.preventDefault();
      find.q.oninput = () => {
        const v = find.q.value.trim();
        history.replaceState(null, '', `/watchlist?tab=history${v ? `&q=${encodeURIComponent(v)}` : ''}`);
        clearTimeout(find.t);
        find.t = setTimeout(() => { route(); document.querySelector('#hist-find input')?.focus(); const i = document.querySelector('#hist-find input'); if (i) i.setSelectionRange(i.value.length, i.value.length); }, 200);
      };
    }
    app.querySelectorAll('.hist-x').forEach((b) => b.onclick = () => {
      const gone = store.removeHistory(b.dataset.id, Number(b.dataset.ep));
      route();
      undoToast('Removed from history.', () => { store.restoreHistory(gone); route(); });
    });
    const clear = document.getElementById('clear-history');
    if (clear) clear.onclick = () => {
      const all = store.getHistory();
      store.clearHistory();
      route();
      undoToast('History cleared.', () => { store.restoreHistory(all); route(); });
    };
    addHub('history');
    return;
  }

  const term = (query.get('q') || '').trim().toLowerCase();
  const type = query.get('type') || '';
  const genre = query.get('genre') || '';
  const year = query.get('year') || '';
  const air = query.get('air') || '';
  const sort = LIST_SORTS.some(([k]) => k === query.get('sort')) ? query.get('sort') : 'recent';
  const sorters = {
    recent: (x, y) => y.updated - x.updated,
    oldest: (x, y) => x.updated - y.updated,
    title: (x, y) => String(x.title).localeCompare(String(y.title)),
    year: (x, y) => (y.year || 0) - (x.year || 0),
    rating: (x, y) => (y.rating || 0) - (x.rating || 0) || y.updated - x.updated,
  };
  const shown = list
    .filter((e) => (tab === 'all' ? inAll(e) : tab === 'favourites' ? e.favourite : e.status === tab)
      && (!type || String(e.format || '').toLowerCase() === type)
      && (!genre || (e.genres || []).includes(genre))
      && (!year || String(e.year || '') === year)
      && (!air || e.air === air)
      && (!term || String(e.title).toLowerCase().includes(term)))
    .sort(sorters[sort]);
  const types = [...new Set(list.map((e) => String(e.format || '').toLowerCase()).filter(Boolean))].sort();
  const genreOpts = [...new Set(list.flatMap((e) => e.genres || []))].sort().map((g) => [g, g]);
  const yearOpts = [...new Set(list.map((e) => e.year).filter(Boolean))].sort((x, y) => y - x).map((y) => [String(y), String(y)]);
  const airOpts = [['RELEASING', 'Airing now'], ['FINISHED', 'Finished'], ['NOT_YET_RELEASED', 'Not aired yet']];
  // Older entries have no genres or airing status saved: fill them in (6 at a time) and redraw once.
  const needMeta = list.filter((e) => !e.genres || !e.air).map((e) => e.id).slice(0, 60);
  if (needMeta.length && !viewWatchlist.filling) {
    viewWatchlist.filling = true;
    (async () => {
      for (let i = 0; i < needMeta.length; i += 6) {
        try { (await api('/batch?ids=' + needMeta.slice(i, i + 6).join(','))).results.forEach((a) => store.rememberMeta(a)); } catch { /* skip */ }
      }
      if (parseHash().parts[0] === 'watchlist' && !document.activeElement?.closest?.('#list-filters')) route();
    })();
  }

  app.innerHTML = `
    ${tab === 'favourites' ? '<h2 class="hub-sub">favourites</h2>' : tabs}
    <form class="filters list-filters" id="list-filters">
      <div class="filter-row"><input class="input q" type="search" name="q" placeholder="Search my list…" value="${esc(query.get('q') || '')}" aria-label="Search my list"></div>
      <div class="filter-grid">
        ${selectField('type', 'Type', types.map((t) => [t, FORMAT[t.toUpperCase()] || t]), type, 'Any type')}
        ${selectField('genre', 'Genre', genreOpts, genre, 'Any genre')}
        ${selectField('year', 'Year', yearOpts, year, 'Any year')}
        ${selectField('air', 'Airing', airOpts, air, 'Any status')}
        ${selectField('sort', 'Sort by', LIST_SORTS, sort, 'Last changed first')}
      </div>
    </form>
    ${shown.length ? `<div class="list-tools"><p class="card-meta">${shown.length.toLocaleString()} show${shown.length === 1 ? '' : 's'}</p>
      <button class="btn sm" id="select-mode" type="button">Select</button>
      <button class="btn sm primary" id="remove-selected" type="button" hidden>Remove selected</button></div>${grid(shown.slice(0, LIST_PAGE).map(asCard))}
      ${shown.length > LIST_PAGE ? '<div class="pager"><button class="btn" id="list-more" type="button">Show more</button></div>' : ''}`
      : list.length ? '<div class="empty"><p>Nothing on your list matches.</p></div>'
      : `<div class="empty"><h2>Nothing here yet</h2><p>Add anime from any details page, or bring your list from AniList or MyAnimeList in <a href="/settings" style="color:var(--accent)">Settings</a>.</p><a class="btn" href="/search">Browse anime</a></div>`}
    ${signInNote}`;

  let showing = LIST_PAGE;
  const more = document.getElementById('list-more');
  if (more) more.onclick = () => {
    app.querySelector('.grid').insertAdjacentHTML('beforeend', shown.slice(showing, showing + LIST_PAGE).map(asCard).map(card).join(''));
    showing += LIST_PAGE;
    if (showing >= shown.length) more.parentElement.remove();
  };

  const form = document.getElementById('list-filters');
  const apply = () => {
    const p = new URLSearchParams();
    if (tab !== 'all') p.set('tab', tab);
    for (const [k, v] of new FormData(form)) if (String(v).trim() && !(k === 'sort' && v === 'recent')) p.set(k, String(v).trim());
    history.replaceState(null, '', '/watchlist' + (p.toString() ? '?' + p : ''));
    route();
  };
  form.onsubmit = (e) => { e.preventDefault(); apply(); };
  form.querySelectorAll('select').forEach((s) => s.onchange = apply);
  let timer;
  form.elements.q.oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 350); };
  if (term) { const box = form.elements.q; box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  addHub(tab === 'favourites' ? 'favourites' : 'list');

  // Select mode: tap cards to pick them, then remove them all at once.
  const selectBtn = document.getElementById('select-mode');
  const removeBtn = document.getElementById('remove-selected');
  if (selectBtn) {
    const picked = new Set();
    const grid = app.querySelector('.grid');
    const sync = () => {
      removeBtn.hidden = !app.classList.contains('selecting');
      removeBtn.textContent = picked.size ? `Remove ${picked.size} selected` : 'Remove selected';
      removeBtn.disabled = !picked.size;
    };
    selectBtn.onclick = () => {
      const on = !app.classList.contains('selecting');
      app.classList.toggle('selecting', on);
      selectBtn.textContent = on ? 'Cancel' : 'Select';
      if (!on) { picked.clear(); grid.querySelectorAll('.card.picked').forEach((c) => c.classList.remove('picked')); }
      sync();
    };
    grid.addEventListener('click', (e) => {
      if (!app.classList.contains('selecting')) return;
      const c = e.target.closest('.card');
      if (!c) return;
      e.preventDefault();
      e.stopPropagation();
      const id = c.dataset.card;
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      c.classList.toggle('picked', picked.has(id));
      sync();
    }, true);
    removeBtn.onclick = () => {
      const items = [...picked].map((id) => list.find((e) => String(e.id) === id)).filter(Boolean);
      items.forEach((it) => (tab === 'favourites' ? store.setFavourite(it, false) : store.setEntry(it, null)));
      toastNote(`Removed ${items.length} show${items.length === 1 ? '' : 's'}.`);
      app.classList.remove('selecting');
      route();
    };
    onCleanup(() => app.classList.remove('selecting'));
  }

  // Sub / dub episode counts on the first cards (anime; cached checks, a few at a time).
  if (!IS_CINEMEE) {
    const ids = shown.slice(0, 24).map((e) => String(e.id));
    (async () => {
      for (let i = 0; i < ids.length; i += 4) {
        await Promise.all(ids.slice(i, i + 4).map(async (id) => {
          const d = await api(`/anime/${id}/availability`).catch(() => null);
          const poster = app.querySelector(`.card[data-card="${id}"] .poster`);
          if (!d || !poster || (!d.sub && !d.dub) || poster.querySelector('.subdub')) return;
          poster.insertAdjacentHTML('beforeend', `<span class="badge subdub">${d.sub ? `SUB ${d.sub}` : ''}${d.sub && d.dub ? ' · ' : ''}${d.dub ? `DUB ${d.dub}` : ''}</span>`);
        }));
        if (parseHash().parts[0] !== 'watchlist') return;
      }
    })();
  }
}

// ---------- account ----------
function viewAccount(query) {
  viewAccountPage(query);
  addHub('account');
}
function viewAccountPage(query) {
  document.title = `Account · ${BRAND.title}`;
  const user = store.currentUser();

  if (user) {
    const list = Object.values(store.getList());
    const history = store.continueList().length;
    const last = store.sync.lastSync ? new Date(store.sync.lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'not yet';
    app.innerHTML = `
      <div class="auth-box">
        <h1 class="page-title" style="margin-top:0">Hey, ${esc(user.name)} 👋</h1>
        <p class="card-meta">Your watchlist, watch history and player settings sync to this account.</p>
        <div class="stats">
          <div><b>${list.length}</b><span>in watchlist</span></div>
          <div><b>${history}</b><span>in progress</span></div>
          <div><b id="last-sync">${last}</b><span>last synced</span></div>
        </div>
        <div class="actions" style="margin-top:18px">
          <button class="btn primary" id="sync-now">Sync now</button>
          <button class="btn" id="logout">Sign out</button>
          <button class="btn" id="logout-all">Sign out everywhere</button>
        </div>
        <details class="danger-zone">
          <summary class="card-meta">Delete my account</summary>
          <p class="card-meta">This deletes your account and the list, progress and settings saved with it on our server. It can't be undone. What's saved in this browser stays until you clear it.</p>
          <form id="delete-account" class="actions">
            <input class="input" type="password" name="password" placeholder="Your password" autocomplete="current-password" required>
            <button class="btn danger" type="submit">Delete my account</button>
          </form>
          <p class="card-meta" id="delete-result" role="status"></p>
        </details>
        <label class="card-meta" style="display:flex;gap:8px;margin-top:14px;cursor:pointer">
          <input type="checkbox" id="clear-local"> Also clear the list and history saved in this browser when signing out
        </label>
      </div>
      <div class="auth-box cal-box">
        <h2 style="margin:0 0 6px">airing calendar</h2>
        <p class="card-meta">Subscribe in Google Calendar, Apple Calendar or Outlook to see when the airing shows on your Watching and Plan to watch lists get new episodes (${IS_CINEMEE ? 'the next episode of each TV show, at its real air time' : 'Japanese broadcast time'}, shown in your time zone). It updates every few hours. The link is private: "Sign out everywhere" turns it off.</p>
        <div class="actions"><button class="btn" id="cal-get" type="button">Get my calendar link</button></div>
        <div id="cal-out" hidden>
          <input class="cal-url" id="cal-url" readonly aria-label="Calendar link">
          <div class="actions">
            <button class="btn sm" id="cal-copy" type="button">Copy link</button>
            <a class="btn sm" id="cal-google" target="_blank" rel="noopener">Add to Google Calendar</a>
            <a class="btn sm" id="cal-apple">Open in Apple / Outlook</a>
          </div>
        </div>
      </div>
      <div class="auth-box share-box">
        <h2 style="margin:0 0 6px">share your list</h2>
        <p class="card-meta">A read-only page anyone with the link can open: titles, list status, favourites and your ratings. Never your progress or history. Off by default.</p>
        <div class="chips" id="share-mode" role="radiogroup" aria-label="Share your list">
          <label class="chip"><input type="radio" name="share" value="off"> Off</label>
          <label class="chip"><input type="radio" name="share" value="all"> Whole list</label>
          <label class="chip"><input type="radio" name="share" value="favourites"> Favourites only</label>
        </div>
        <div class="actions" id="share-out" hidden><input class="cal-url" id="share-url" readonly aria-label="Your list's link"><button class="btn sm" id="share-copy" type="button">Copy link</button></div>
        <p class="card-meta" id="share-msg" role="status"></p>
      </div>`;
    // Sharing: read the current choice, change it with the radio buttons.
    const shareBox = document.getElementById('share-mode');
    const showShare = ({ mode, url }) => {
      shareBox.querySelectorAll('input').forEach((i) => { i.checked = i.value === mode; });
      document.getElementById('share-url').value = url || '';
      document.getElementById('share-out').hidden = mode === 'off';
    };
    fetch('/api/me/share', { credentials: 'same-origin' }).then((r) => r.json()).then(showShare).catch(() => {});
    shareBox.onchange = async (e) => {
      const msg = document.getElementById('share-msg');
      try {
        const r = await fetch('/api/me/share', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: e.target.value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Failed');
        showShare(d);
        msg.textContent = d.mode === 'off' ? 'Your list is private again (a copy someone already opened can stay up to 5 minutes).' : 'Shared. Send the link to anyone.';
      } catch (err) { msg.textContent = err.message; }
    };
    document.getElementById('share-copy').onclick = async () => {
      const url = document.getElementById('share-url').value;
      try { await navigator.clipboard.writeText(url); toastNote('Link copied.'); } catch { prompt('Copy this link', url); }
    };
    document.getElementById('cal-get').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await fetch('/api/me/calendar', { credentials: 'same-origin' });
        const { url } = await r.json();
        if (!url) throw new Error();
        const webcal = url.replace(/^https?:/, 'webcal:');
        document.getElementById('cal-url').value = url;
        document.getElementById('cal-google').href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal);
        document.getElementById('cal-apple').href = webcal;
        document.getElementById('cal-out').hidden = false;
        e.target.hidden = true;
      } catch {
        e.target.disabled = false;
        e.target.textContent = "Couldn't get the link, try again";
      }
    };
    document.getElementById('cal-copy').onclick = async (e) => {
      const input = document.getElementById('cal-url');
      try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
      e.target.textContent = 'Copied ✓';
    };
    document.getElementById('sync-now').onclick = async (e) => {
      e.target.disabled = true;
      await store.sync.pull().catch(() => {});
      route();
    };
    const out = (everywhere) => async () => {
      await store.logout({ everywhere, clearLocal: document.getElementById('clear-local').checked });
      go('/');
    };
    document.getElementById('logout').onclick = out(false);
    document.getElementById('logout-all').onclick = out(true);
    document.getElementById('delete-account').onsubmit = async (e) => {
      e.preventDefault();
      const result = document.getElementById('delete-result');
      if (!confirm('Delete your account for good? This cannot be undone.')) return;
      try {
        await store.deleteAccount(e.target.elements.password.value);
        result.textContent = 'Your account is deleted.';
        setTimeout(() => go('/'), 1200);
      } catch (err) {
        result.textContent = err.message;
      }
    };
    return;
  }

  const mode = query.get('mode') === 'register' ? 'register' : 'login';
  app.innerHTML = `
    <div class="auth-box">
      <div class="tabs" style="margin-top:0">
        <a class="tab${mode === 'login' ? ' on' : ''}" href="/account">Sign in</a>
        <a class="tab${mode === 'register' ? ' on' : ''}" href="/account?mode=register">Create account</a>
      </div>
      <form id="auth-form" class="auth-form">
        <label>Username<input class="input" name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+"></label>
        <label>Password<input class="input" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="8" maxlength="128"></label>
        <div class="auth-err" id="auth-err" hidden></div>
        <button class="btn primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <p class="card-meta">${mode === 'login' ? 'No account yet? <a href="/account?mode=register" style="color:var(--accent)">Create one</a>' : 'No email needed. Anything you already watched in this browser gets added to your account.'}</p>
      </form>
    </div>`;

  const form = document.getElementById('auth-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const err = document.getElementById('auth-err');
    btn.disabled = true;
    err.hidden = true;
    try {
      const { username, password } = Object.fromEntries(new FormData(form));
      await (mode === 'login' ? store.login(username, password) : store.register(username, password));
      go('/');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  };
}

// ---------- schedule ----------
const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
function schedRow(a, note) {
  if (a?.id) cardShows.set(String(a.id), a);
  const following = store.isFollowing(a.id);
  return `<a class="sched-row" href="${animeHref(a)}">
    <button class="row-bell${following ? ' on' : ''}" type="button" data-follow="${esc(a.id)}" aria-pressed="${following}" title="${following ? 'Following: tap to stop' : 'Tell me about new episodes'}">${following ? '🔔' : '🔕'}</button>
    ${IS_CINEMEE ? (a.airingAt ? `<span class="sched-time"><b>${new Date(a.airingAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b><small>your time</small></span>` : '<span class="sched-time"><b>new</b><small>episode</small></span>') : `<span class="sched-time"><b>${esc(a.broadcast?.time || '?')}</b><small>JST</small></span>`}
    <img src="${esc(a.cover)}" alt="${esc(T(a))} poster" loading="lazy">
    <span class="sched-info"><span class="t">${esc(T(a))}</span>
      <span class="card-meta">${[FORMAT[a.format], a.score ? `★ ${score(a.score)}` : '', note].filter(Boolean).join(' · ')}</span></span>
  </a>`;
}
async function viewSchedule(query, alive) {
  document.title = `Schedule · ${BRAND.title}`;
  // Days follow Japan time: offset -1 is yesterday there, 0 today, up to 5 days ahead.
  const JST = 9 * 3600e3;
  const jstNow = new Date(Date.now() + JST);
  const offset = Math.min(5, Math.max(-1, Number(query.get('d')) || 0));
  const mine = query.get('mine') === '1';
  const dayOf = (o) => new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + o));
  const label = (o) => {
    const date = dayOf(o).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const name = o === -1 ? 'Yesterday' : o === 0 ? 'Today' : dayOf(o).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    return `${name} <small>${date}</small>`;
  };
  const weekday = WEEK[(dayOf(offset).getUTCDay() + 6) % 7];
  const link = (o, m = mine) => `/schedule?d=${o}${m ? '&mine=1' : ''}`;
  const myIds = new Set(store.libraryIds());

  app.innerHTML = `<h1 class="page-title">Airing schedule</h1>
    <p class="card-meta">${IS_CINEMEE ? 'TV shows with a new episode out on each day, at your local time when it’s known.' : 'Days follow Japan time. Each show also lists when it airs where you are.'}</p>
    <form class="filter-row sched-find" id="sched-find">
      <input class="input" type="search" name="q" placeholder="Find a show's next episode…" aria-label="Find a show's next episode">
      <button class="btn" type="submit">Find</button>
    </form>
    <div id="sched-found"></div>
    <div class="tabs">${[-1, 0, 1, 2, 3, 4, 5].map((o) => `<a class="tab${o === offset ? ' on' : ''}" href="${link(o)}">${label(o)}</a>`).join('')}</div>
    <label class="card-meta sched-mine"><input type="checkbox" id="only-mine"${mine ? ' checked' : ''}> Just my shows (on my list or started)</label>
    <div id="sched">${loader()}</div>`;

  document.getElementById('only-mine').onchange = (e) => location.replace(link(offset, e.target.checked));
  document.getElementById('sched-find').onsubmit = async (e) => {
    e.preventDefault();
    const term = String(new FormData(e.target).get('q') || '').trim().toLowerCase();
    const out = document.getElementById('sched-found');
    if (!term) { out.innerHTML = ''; return; }
    out.innerHTML = loader();
    const week = await Promise.all(WEEK.map((d) => api(`/schedule?day=${d}`).then((r) => r.results).catch(() => [])));
    if (!alive()) return;
    const hits = [...new Map(week.flat().filter((a) => [a.title, a.titleRomaji, ...(a.synonyms || [])].some((t) => String(t || '').toLowerCase().includes(term))).map((a) => [a.id, a])).values()];
    out.innerHTML = hits.length
      ? `<div class="sched found">${hits.map((a) => { const at = nextBroadcast(a.broadcast); return schedRow(a, at ? `next episode ${localTime(at)}, in ${fmtCountdown(Math.round((at - Date.now()) / 1000))}` : 'no fixed time'); }).join('')}</div>`
      : `<p class="card-meta">“${esc(term)}” isn't on this week's schedule.</p>`;
  };

  const d = await api(`/schedule?day=${weekday}`);
  if (!alive()) return;
  const rows = d.results
    .filter((a) => !mine || myIds.has(String(a.id)))
    .sort((x, y) => (IS_CINEMEE
      ? (x.airingAt || Infinity) - (y.airingAt || Infinity)
      : String(x.broadcast?.time || '99').localeCompare(String(y.broadcast?.time || '99'))));
  document.getElementById('sched').innerHTML = rows.length ? `<div class="sched">${rows.map((a) => {
    // cinemee: exact times from TVmaze where it knows the show.
    if (IS_CINEMEE) return schedRow(a, !a.airingAt ? '' : a.airingAt < Date.now() ? 'aired' : `in ${fmtCountdown(Math.round((a.airingAt - Date.now()) / 1000))}`);
    const at = nextBroadcast(a.broadcast);
    // A show from earlier today has its next airing a week away.
    const airedToday = offset === 0 && at && at - Date.now() > 6 * 86400e3;
    const note = offset < 0 || airedToday ? 'aired' : at ? `your time ${localTime(at)} · in ${fmtCountdown(Math.round((at - Date.now()) / 1000))}` : '';
    return schedRow(a, note);
  }).join('')}</div>` : `<div class="empty"><p>${mine ? 'None of your shows air on this day.' : 'Nothing scheduled for this day.'}</p></div>`;
}

// ---------- A-Z list ----------
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
async function viewAZ(query, alive) {
  document.title = `A-Z list · ${BRAND.title}`;
  const letter = LETTERS.includes((query.get('letter') || '').toUpperCase()) ? query.get('letter').toUpperCase() : '';
  const page = Math.max(1, Number(query.get('page')) || 1);
  app.innerHTML = `<h1 class="page-title">${letter ? `${IS_CINEMEE ? 'Titles' : 'Anime'} starting with ${letter}` : `${IS_CINEMEE ? 'Titles' : 'Anime'} A-Z`}</h1>
    <p class="card-meta">Know the name but not the spelling? Jump to its first letter.</p>
    <nav class="az-bar" aria-label="Letters">
      <a class="chip${letter ? '' : ' on'}" href="/az">All</a>
      ${LETTERS.map((l) => `<a class="chip${l === letter ? ' on' : ''}" href="/az?letter=${l}">${l}</a>`).join('')}
    </nav>
    <div id="az-results">${loader()}</div>`;
  const params = new URLSearchParams({ order: 'title', page: String(page) });
  if (letter) params.set('letter', letter);
  const d = await api('/search?' + params);
  if (!alive()) return;
  const info = d.pageInfo || {};
  const pageLink = (n) => `/az?${letter ? `letter=${letter}&` : ''}page=${n}`;
  document.getElementById('az-results').innerHTML =
    (info.total ? `<p class="card-meta">${info.total.toLocaleString()} titles</p>` : '') +
    `<div class="section">${grid(d.results)}</div>` +
    ((info.hasNextPage || page > 1) ? `<div class="pager">
      ${page > 1 ? `<a class="btn sm" href="${pageLink(page - 1)}">‹ Previous</a>` : ''}
      <span>Page ${page}${info.lastPage ? ` of ${info.lastPage}` : ''}</span>
      ${info.hasNextPage ? `<a class="btn sm" href="${pageLink(page + 1)}">Next ›</a>` : ''}
    </div>` : '');
}

// ---------- help me pick ----------
const MOODS = IS_CINEMEE ? [
  ['laugh', 'Make me laugh', ['Comedy']], ['romance', 'Something romantic', ['Romance']], ['fights', 'Big action', ['Action']],
  ['cozy', 'Something for the family', ['Family']], ['guessing', 'Keep me guessing', ['Mystery']], ['scare', 'Scare me', ['Horror']],
  ['future', 'Into the future', ['Science Fiction']], ['cry', 'Make me cry', ['Drama']], ['real', 'True stories', ['Documentary']],
] : [
  ['laugh', 'Make me laugh', ['Comedy']], ['romance', 'Something romantic', ['Romance']], ['fights', 'Big fights', ['Action']],
  ['cozy', 'Calm and cozy', ['Iyashikei']], ['guessing', 'Keep me guessing', ['Mystery']], ['scare', 'Scare me', ['Horror']],
  ['isekai', 'Another world', ['Isekai']], ['cry', 'Make me cry', ['Drama']], ['sports', 'Sports and teamwork', ['Sports']],
];
const LENGTHS = IS_CINEMEE ? [['movie', 'A movie', 'MOVIE'], ['series', 'A series', 'TV']]
  : [['short', 'Short, up to 13 episodes', 1, 13], ['mid', 'One or two seasons, 14 to 26', 14, 26], ['long', 'Long, more than 26', 27, 99999]];
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

async function viewPick(alive) {
  document.title = `Help me pick · ${BRAND.title}`;
  const { genres } = await api('/genres').catch(() => ({ genres: [] }));
  if (!alive()) return;
  let liked = null; // { id, title }
  app.innerHTML = `<h1 class="page-title">Help me pick</h1>
    <p class="card-meta">Stuck on what to watch next? Start from a mood, a genre or a show you already like. One answer is enough; more narrow it down.</p>
    <form class="pick" id="pick">
      <fieldset><legend>1. How do you want to feel?</legend>
        <div class="chips">${MOODS.map(([k, l]) => `<label class="chip check"><input type="radio" name="mood" value="${k}"> ${l}</label>`).join('')}
          <label class="chip check"><input type="radio" name="mood" value="" checked> Any mood</label></div>
      </fieldset>
      <fieldset><legend>2. A genre</legend>
        <select name="genre" aria-label="Genre"><option value="">Any genre</option>${genres.map((g) => `<option>${esc(g)}</option>`).join('')}</select>
      </fieldset>
      <fieldset><legend>3. ${IS_CINEMEE ? 'A movie or show' : 'An anime'} you already like</legend>
        <div class="pick-like">
          <input class="input" type="search" id="like-q" placeholder="Type a title…" autocomplete="off" aria-label="${IS_CINEMEE ? 'A movie or show' : 'An anime'} you already like">
          <div class="suggest" id="like-suggest" hidden></div>
        </div>
        <div id="like-chosen" class="card-meta"></div>
      </fieldset>
      <fieldset><legend>How long?</legend>
        <select name="size" aria-label="Length"><option value="">Any length</option>${LENGTHS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </fieldset>
      <button class="btn primary" type="submit">Show my picks</button>
    </form>
    <div id="picks"></div>`;

  // "An anime you like" uses the same suggestions as the search bar.
  const likeQ = document.getElementById('like-q');
  const likeBox = document.getElementById('like-suggest');
  let timer; let seq = 0;
  likeQ.oninput = () => {
    clearTimeout(timer);
    const q = likeQ.value.trim();
    const my = ++seq;
    if (q.length < 3) { likeBox.hidden = true; return; }
    timer = setTimeout(async () => {
      const d = await api('/search?q=' + encodeURIComponent(q)).catch(() => ({ results: [] }));
      if (my !== seq || !alive()) return;
      likeBox.innerHTML = d.results.slice(0, 5).map((a) => `<button type="button" data-id="${a.id}" data-title="${esc(T(a))}"><img src="${esc(a.cover)}" alt=""><span class="s-title">${esc(T(a))}</span></button>`).join('') || '<div class="s-empty">No matches found.</div>';
      likeBox.hidden = false;
    }, 400);
  };
  likeBox.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    liked = { id: b.dataset.id, title: b.dataset.title };
    likeBox.hidden = true;
    likeQ.value = '';
    document.getElementById('like-chosen').innerHTML = `Picked: <b>${esc(liked.title)}</b> <button class="link-btn" type="button" id="like-clear">remove</button>`;
    document.getElementById('like-clear').onclick = () => { liked = null; document.getElementById('like-chosen').innerHTML = ''; };
  };

  document.getElementById('pick').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    const mood = MOODS.find(([k]) => k === form.get('mood'));
    const length = LENGTHS.find(([k]) => k === form.get('size'));
    const wanted = [...new Set([...(mood ? mood[2] : []), ...(form.get('genre') ? [form.get('genre')] : [])])];
    const out = document.getElementById('picks');
    if (!wanted.length && !liked) { out.innerHTML = '<p class="card-meta">Pick a mood, a genre or a show you like first.</p>'; return; }
    out.innerHTML = loader();
    try {
      let candidates = [];
      if (liked && !wanted.length) {
        // Only a liked show: use what fans of it recommend.
        candidates = (await api(`/anime/${liked.id}/extras`)).recommendations;
      } else {
        const base = new URLSearchParams({ genres: wanted.join(','), order: 'score', score: '7' });
        const pages = await Promise.all([1, 2].map((p) => api(`/search?${base}&page=${p}`).catch(() => ({ results: [] }))));
        candidates = pages.flatMap((p) => p.results);
        if (liked) {
          // Put shows that fans of the liked one recommend first.
          const recIds = new Set((await api(`/anime/${liked.id}/extras`).catch(() => ({ recommendations: [] }))).recommendations.map((r) => r.id));
          candidates.sort((x, y) => (recIds.has(y.id) ? 1 : 0) - (recIds.has(x.id) ? 1 : 0));
        }
      }
      if (!alive()) return;
      if (length) candidates = IS_CINEMEE ? candidates.filter((a) => a.format === length[2])
        : candidates.filter((a) => a.episodes && a.episodes >= length[2] && a.episodes <= length[3]);
      const seen = new Set([liked?.id].filter(Boolean));
      candidates = unstarted(candidates.filter((a) => !seen.has(a.id) && seen.add(a.id)));
      const picks = shuffle(candidates.slice(0, 36)).slice(0, 12);
      out.innerHTML = picks.length
        ? section(`Your ${picks.length} picks`, grid(picks), '<button class="link-btn" type="button" id="reroll">Shuffle again</button>')
        : '<div class="empty"><p>Nothing matched all of that. Try a different length or fewer choices.</p></div>';
      const reroll = document.getElementById('reroll');
      if (reroll) reroll.onclick = () => e.target.requestSubmit();
    } catch (err) {
      out.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
    }
  };
}

// ---------- settings ----------
const ANILIST_IMPORT_LIMIT = 4000;
function viewSettings(alive) {
  document.title = `Settings · ${BRAND.title}`;
  const s = store.getSettings();
  const user = store.currentUser();
  const radio = (name, value, label, current) => `<label class="chip check"><input type="radio" name="${name}" value="${value}"${current === value ? ' checked' : ''}> ${label}</label>`;
  const toggle = (name, label, on) => `<label class="setting-toggle"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
  app.innerHTML = `<h2 class="hub-sub">settings</h2>
    <p class="card-meta">Saved in this browser.${user ? ` Signed in as <b>${esc(user.name)}</b>: your list and playback choices also sync to your account.` : ' <a href="/account" style="color:var(--accent)">Sign in</a> to sync your list across devices.'}</p>
    <form id="settings" class="settings">
      <section class="settings-group"><h2>Display</h2>
        <div class="setting anime-only"><span>Anime names in</span><div class="chips">${radio('titles', 'english', 'English', s.titles)}${radio('titles', 'japanese', 'Japanese', s.titles)}</div></div>
      </section>
      <section class="settings-group"><h2>Home page</h2>
        ${toggle('showContinue', 'Show Continue watching on the home page', s.showContinue)}
        ${toggle('hideStarted', 'Hide shows I already started from the home rows and picks', s.hideStarted)}
      </section>
      <section class="settings-group" id="hide-genres"><h2>Hide genres</h2>
        <p class="card-meta">Shows in these genres stay out of the home rows, picks and browsing. Searching by name still finds them.</p>
        <div class="chips" id="hide-genre-chips">${loader()}</div>
      </section>
      <section class="settings-group"><h2>Player</h2>
        <div class="setting anime-only"><span>Audio I prefer</span><div class="chips">${radio('category', 'sub', 'Sub', s.category)}${radio('category', 'dub', 'Dub', s.category)}</div></div>
        ${toggle('autoplay', 'Play the next episode automatically', s.autoplay)}
        ${toggle('skipFiller', 'Skip filler and recap episodes when playing the next one', !!s.skipFiller)}
        <span class="anime-only">${toggle('autoskip', 'Skip intros and outros automatically (on the 3ellwa server)', !!s.autoskip)}</span>
        ${toggle('wide', 'Use the wide player', !!s.wide)}
      </section>
      <section class="settings-group" id="alerts"><h2>Notifications</h2>
        <div class="setting anime-only"><span>Episode alerts for</span><div class="chips">${radio('alertsFor', 'both', 'Sub and dub', s.alertsFor || 'both')}${radio('alertsFor', 'sub', 'Sub only', s.alertsFor)}${radio('alertsFor', 'dub', 'Dub only', s.alertsFor)}</div></div>
        <div class="setting"><span>Pop-ups</span><div class="chips">${radio('alertsWhen', 'now', 'Each new episode', s.alertsWhen || 'now')}${radio('alertsWhen', 'weekly', 'Weekly summary (Sundays)', s.alertsWhen)}</div></div>
        <p class="card-meta">New episodes of shows you follow with 🔔 (and of airing shows on your Watching list) show up in <a href="/new">Notifications</a>.</p>
      </section>
    </form>

    <section class="settings-group" id="push-group"><h2>Pop-ups on this device</h2>
      <p class="card-meta">Get a pop-up when a show you follow gets a new episode, even when ${BRAND.name} is closed.</p>
      <p class="card-meta" id="push-status" role="status">Checking…</p>
      <div class="actions"><button class="btn" id="push-toggle" type="button" hidden></button>
        <button class="btn" id="push-test" type="button" hidden>Send a test pop-up</button></div>
    </section>

    <section class="settings-group" id="install-group"><h2>Install the app</h2>
      <p class="card-meta">Add ${BRAND.title} to your phone or computer and open it like an app, full screen and one tap away. No app store needed.</p>
      <button class="btn" id="install" type="button">Install the app</button>
      <p class="card-meta" id="install-note"></p>
    </section>

    <section class="settings-group anime-only" id="import"><h2>Bring your list</h2>
      <p class="card-meta">Shows that aren't in the catalogue, or are adult-rated, are skipped. Your choice of “add” or “replace” only changes list statuses; watch progress is kept.</p>
      <form id="import-anilist" class="filter-row import-row">
        <input class="input" name="user" placeholder="AniList username" aria-label="AniList username" required pattern="[A-Za-z0-9_]{2,20}">
        <select name="mode" aria-label="Import mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Import from AniList</button>
      </form>
      <p class="card-meta">The AniList list must be public.</p>
      <form id="import-mal" class="filter-row import-row">
        <input class="input" type="file" name="file" accept=".xml,.gz,application/xml,text/xml,application/gzip" aria-label="MyAnimeList export file" required>
        <select name="mode" aria-label="Import mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Import MyAnimeList file</button>
      </form>
      <p class="card-meta">On MyAnimeList, open <i>Export</i> from your list settings, choose Anime, and upload the .xml or .xml.gz file here.</p>
      <p class="import-result" id="import-result" role="status"></p>
    </section>

    <section class="settings-group"><h2>Backup</h2>
      <p class="card-meta">Download your list, progress and history as a file, or restore one.</p>
      <div class="filter-row import-row">
        <button class="btn" id="backup-download" type="button">Download my list</button>
      </div>
      <form id="backup-restore" class="filter-row import-row">
        <input class="input" type="file" name="file" accept=".json,application/json" aria-label="Backup file" required>
        <select name="mode" aria-label="Restore mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Restore</button>
      </form>
      <p class="import-result" id="backup-result" role="status"></p>
    </section>

    <section class="settings-group"><h2>Privacy</h2>
      <p class="card-meta">Your list, history and settings are kept in this browser. With an account, your list, progress and playback choices are also stored on our server so they sync. Watch history never leaves this browser. Clearing site data removes everything here.</p>
      <div class="actions"><button class="btn sm" id="clear-history" type="button">Clear watch history</button>
        <button class="btn sm" id="clear-progress" type="button">Clear history and every watched tick</button></div>
    </section>`;

  // Hide genres: chips filled from the catalogue's genre list.
  api('/genres').then(({ genres }) => {
    const box = document.getElementById('hide-genre-chips');
    if (!box) return;
    const hidden = new Set(store.getSettings().hiddenGenres || []);
    box.innerHTML = genres.map((g) => `<label class="chip check"><input type="checkbox" data-hide-genre value="${esc(g)}"${hidden.has(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('');
  }).catch(() => {});
  document.getElementById('hide-genres').addEventListener('change', (e) => {
    if (!e.target.matches('[data-hide-genre]')) return;
    e.stopPropagation();
    const set = new Set(store.getSettings().hiddenGenres || []);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    store.setSetting('hiddenGenres', [...set]);
  });

  // Settings apply as soon as they change.
  const form = document.getElementById('settings');
  form.onchange = (e) => {
    const el = e.target;
    if (el.matches('[data-hide-genre]')) return; // handled above
    store.setSetting(el.name, el.type === 'checkbox' ? el.checked : el.value);
    if (el.name === 'alertsWhen') push.syncFollows();
    if (el.name === 'alertsFor') { push.syncFollows(); inbox.refreshInbox({ force: true }).catch(() => {}); }
  };

  // Pop-ups on this device.
  const pushStatus = document.getElementById('push-status');
  const pushToggle = document.getElementById('push-toggle');
  const pushTest = document.getElementById('push-test');
  const drawPush = async () => {
    if (!push.supported()) { pushStatus.textContent = 'This browser can\'t show pop-ups.'; return; }
    if (!(await push.serverKey())) { pushStatus.textContent = `Pop-ups aren't switched on for ${BRAND.name} yet.`; return; }
    const on = await push.isOn();
    const perm = push.permission();
    const following = store.followedIds().length;
    pushStatus.textContent = on
      ? `On. You follow ${following} show${following === 1 ? '' : 's'}; each new episode pops up here.`
      : perm === 'denied'
        ? `Your browser is blocking notifications for ${BRAND.name}. Click the icon left of the address, set Notifications to Allow, then press Turn on.`
        : push.needsInstall() ? `On iPhone and iPad, add ${BRAND.name} to your Home Screen first (Share → Add to Home Screen), then turn pop-ups on from there.`
          : 'Off on this device.';
    pushToggle.hidden = false;
    pushToggle.textContent = on ? 'Turn off' : 'Turn on pop-ups';
    pushTest.hidden = !on;
  };
  pushToggle.onclick = async () => {
    pushToggle.disabled = true;
    try {
      if (await push.isOn()) await push.disable(); else await push.enable();
      await drawPush();
    } catch (err) { pushStatus.textContent = err.message; } finally { pushToggle.disabled = false; }
  };
  pushTest.onclick = async () => {
    pushTest.disabled = true;
    try {
      const r = await push.test();
      pushStatus.textContent = r.ok ? 'Test sent. It should pop up in a few seconds.' : 'The push service didn\'t accept it. Try turning pop-ups off and on.';
    } catch (err) { pushStatus.textContent = err.message; } finally { pushTest.disabled = false; }
  };
  drawPush();

  // Install: browsers that support it fire beforeinstallprompt; iPhone and iPad need the Share menu.
  const installBtn = document.getElementById('install');
  const installNote = document.getElementById('install-note');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) { installBtn.hidden = true; installNote.textContent = 'You are already using the installed app.'; }
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { installBtn.hidden = true; installNote.textContent = 'On iPhone or iPad: tap Share in Safari, then Add to Home Screen.'; }
  installBtn.onclick = async () => {
    if (!installPrompt) { installNote.textContent = `Your browser doesn't offer installing right now. In Chrome or Edge, use the install icon in the address bar, or the menu, then Install ${BRAND.title}.`; return; }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    installPrompt = null;
    installNote.textContent = outcome === 'accepted' ? `Installed. You can open ${BRAND.title} from your home screen or apps.` : '';
  };

  const importResult = document.getElementById('import-result');
  const finishImport = (added, skipped, source) => {
    importResult.textContent = `${added.toLocaleString()} show${added === 1 ? '' : 's'} added from ${source}${skipped ? `, ${skipped.toLocaleString()} skipped` : ''}.`;
    store.ensureMeta(store.libraryIds()).catch(() => {});
  };

  document.getElementById('import-anilist').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    importResult.textContent = 'Reading your AniList list…';
    try {
      // Asked from the browser: AniList refuses requests from Cloudflare's servers.
      const d = await aniList.importAniListUser(f.get('user'));
      const items = d.items.slice(0, ANILIST_IMPORT_LIMIT);
      finishImport(store.importEntries(items, f.get('mode')), d.skipped + (d.items.length - items.length), 'AniList');
    } catch (err) {
      importResult.textContent = err.message;
    } finally { btn.disabled = false; }
  };

  document.getElementById('import-mal').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const file = f.get('file');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    importResult.textContent = 'Reading your MyAnimeList file…';
    try {
      const text = /\.gz$/i.test(file.name)
        ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await readFile(file);
      const { items, skipped } = parseMalExport(text);
      finishImport(store.importEntries(items, f.get('mode')), skipped, 'MyAnimeList');
    } catch (err) {
      importResult.textContent = err.message;
    } finally { btn.disabled = false; }
  };

  document.getElementById('backup-download').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportBackup(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${BRAND.backup}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('backup-restore').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById('backup-result');
    if (f.get('mode') === 'replace' && !confirm('Replace your whole list with this backup?')) return;
    try {
      const restored = store.restoreBackup(JSON.parse(await readFile(f.get('file'))), f.get('mode'));
      out.textContent = restored ? `${restored.toLocaleString()} show${restored === 1 ? '' : 's'} restored.` : 'Nothing new to restore: everything in that file is already on your list.';
    } catch (err) {
      out.textContent = err instanceof SyntaxError ? 'That file isn\'t a valid backup.' : err.message;
    }
  };
  document.getElementById('clear-history').onclick = (e) => {
    if (!confirm('Clear your watch history in this browser?')) return;
    store.clearHistory();
    e.target.textContent = 'History cleared';
  };
  document.getElementById('clear-progress').onclick = (e) => {
    if (!confirm('Clear your watch history, Continue watching and every watched tick? Your list and favourites stay.')) return;
    store.clearHistory();
    store.clearProgress();
    e.target.textContent = 'Cleared';
  };
  addHub('settings');
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// MyAnimeList's export: <anime><series_animedb_id/><series_title/><series_type/><series_episodes/><my_watched_episodes/><my_status/></anime>
const MAL_STATUS = { watching: 'watching', 'plan to watch': 'planning', completed: 'completed', 'on-hold': 'paused', dropped: 'dropped' };
function parseMalExport(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('myanimelist')) throw new Error('That file isn\'t a MyAnimeList anime export.');
  const field = (node, name) => node.querySelector(name)?.textContent.trim() || '';
  let skipped = 0;
  const items = [];
  for (const node of doc.querySelectorAll('anime')) {
    const id = field(node, 'series_animedb_id');
    const status = MAL_STATUS[field(node, 'my_status').toLowerCase()] || MAL_STATUS[{ 1: 'watching', 2: 'completed', 3: 'on-hold', 4: 'dropped', 6: 'plan to watch' }[field(node, 'my_status')]];
    if (!/^\d+$/.test(id) || !status) { skipped++; continue; }
    const episodes = Number(field(node, 'series_episodes')) || null;
    items.push({
      id, status,
      title: field(node, 'series_title') || null,
      format: field(node, 'series_type').toUpperCase() || null,
      episodes,
      watchedUpTo: status === 'completed' ? episodes || Number(field(node, 'my_watched_episodes')) || 0 : Number(field(node, 'my_watched_episodes')) || 0,
    });
  }
  if (!items.length && !skipped) throw new Error('No anime found in that file.');
  return { items, skipped };
}

function viewNotFound() {
  app.innerHTML = '<div class="empty lost" data-kao="-_-."><h2>404, this page wandered off</h2><p>The link is broken or the page never existed.</p><a class="btn primary" href="/">Take me home</a></div>';
}

// ---------- nav search with suggestions ----------
function setupSearch() {
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
let installPrompt = null;
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
const newBadge = document.getElementById('nav-new-count');
const showBadge = (items) => { if (newBadge) { newBadge.textContent = items.length; newBadge.hidden = !items.length; } };
inbox.onInboxChange(showBadge);
showBadge(inbox.inboxItems());
window.addEventListener('animee:navigate', () => showBadge(inbox.inboxItems()));

// account label in the nav + refresh list pages after the first sync
const navAccount = document.getElementById('nav-account');
let firstSync = true;
store.onSyncChange(({ user, synced, changed }) => {
  navAccount.textContent = user ? user.name : 'Sign in';
  if (synced && (firstSync || changed?.size)) {
    firstSync = false;
    const page = parseHash().parts[0];
    if (page === undefined || page === 'watchlist') route(); // never interrupt the player
  }
});

// A notice from the site owner (set on /admin), until it expires or you close it.
const NOTICE_KEY = 'animee-space:notice-closed';
function showNotice() {
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

route();
showNews();
showNotice();
// The footer's link to the other site follows the current address (cinemee.localhost in development).
document.querySelectorAll('.sibling-link').forEach((a) => { a.href = `${SIBLING.origin}/`; });
store.initAccount().finally(() => setTimeout(() => {
  inbox.refreshInbox().catch(() => {});
  push.syncFollows(); // follows may have changed on another device
}, 1500));
