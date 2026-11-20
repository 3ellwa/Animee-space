import { api } from './api.js';
import * as store from './store.js';
import { Player } from './player.js';
import './fx.js';

const app = document.getElementById('app');
let cleanups = [];
let navToken = 0;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMAT = { TV: 'TV', TV_SHORT: 'TV Short', TV_SPECIAL: 'TV Special', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const STATUS = { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' };
const SEASON = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
const TYPE_OPTIONS = [['tv', 'TV series'], ['movie', 'Movie'], ['ova', 'OVA'], ['ona', 'ONA'], ['special', 'Special'], ['music', 'Music']];
const STATUS_OPTIONS = [['airing', 'Airing now'], ['complete', 'Finished'], ['upcoming', 'Not aired yet']];
const SEASON_OPTIONS = [['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall']];
const RATING_OPTIONS = [['g', 'G, all ages'], ['pg', 'PG, children'], ['pg13', 'PG-13, teens'], ['r17', 'R, 17+']];
const ORDER_OPTIONS = [['popular', 'Most popular'], ['score', 'Best rated'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['title', 'Title A-Z']];
const LIST_TITLES = { airing: 'Top airing', popular: 'Most popular', favorite: 'Most favourited', upcoming: 'Coming soon', season: 'This season', completed: 'Just completed' };
// Short paths that open the browse page with a preset filter.
const SHORTCUTS = { tv: 'type=tv', movies: 'type=movie', ova: 'type=ova', ona: 'type=ona', specials: 'type=special', airing: 'status=airing', upcoming: 'status=upcoming' };
const MAX_GENRES = 5;
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
// The title to show, following the English / Japanese setting.
const T = (a) => (store.getSettings().titles === 'japanese' && a?.titleRomaji ? a.titleRomaji : a?.title || '');
// Rows and picks leave out shows marked "Not interested", and shows already started when that setting is on.
const unstarted = (list) => {
  const hidden = store.notInterestedIds();
  if (store.getSettings().hideStarted) for (const id of store.startedIds()) hidden.add(id);
  return hidden.size ? list.filter((a) => !hidden.has(String(a.id))) : list;
};
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

function card(a) {
  return `<a class="card" href="#/anime/${a.id}" title="${esc(T(a))}">
    <div class="poster" style="--c:${esc(a.color || '#1e1a2b')}">
      <img loading="lazy" src="${esc(a.cover)}" alt="${esc(T(a))} poster">
      ${a.score ? `<span class="badge score">★ ${score(a.score)}</span>` : ''}
      ${a.status === 'RELEASING' ? '<span class="badge airing">Airing</span>' : ''}
      ${FORMAT[a.format] === 'Movie' ? '<span class="badge eps">Movie</span>'
        : epsLabel(a) !== '?' ? `<span class="badge eps">${epsLabel(a)} eps</span>` : ''}
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
const rankCards = (list) => list.map((a, i) => `<a class="rank-card" href="#/anime/${a.id}" title="${esc(T(a))}">
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
function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
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
  setActiveNav(parts[0] || 'home');
  window.scrollTo(0, 0);
  app.innerHTML = loader();

  if (SHORTCUTS[parts[0]]) return location.replace('#/search?' + SHORTCUTS[parts[0]]);

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
      case 'watch': return await viewWatch(parts[1], query, alive);
      case 'watchlist': return viewWatchlist(query);
      case 'schedule': return await viewSchedule(query, alive);
      case 'account': return viewAccount(query);
      default: return viewNotFound();
    }
  } catch (err) {
    if (!alive()) return;
    // 4xx answers (bad link, missing title) won't fix themselves, so only offer a retry for the rest.
    const lasting = err.status >= 400 && err.status < 500;
    app.innerHTML = `<div class="error" data-kao="${lasting ? '(._.)' : '(x_x)'}"><h2>${lasting ? 'Nothing here' : "Couldn't load this page"}</h2><p>${esc(err.message)}</p>
      ${lasting ? '<a class="btn primary" href="#/">Go home</a>' : '<button class="btn primary" id="retry">Try again</button>'}</div>`;
    document.getElementById('retry')?.addEventListener('click', route);
  }
}

// ---------- home ----------
async function viewHome(alive) {
  const d = await api('/home');
  if (!alive()) return;
  const season = d.recent || [];
  const cont = store.getSettings().showContinue ? store.continueList().filter(p => p.title) : [];
  const quick = [['TV series', '#/tv'], ['Movies', '#/movies'], ['Airing now', '#/airing'], ['Coming soon', '#/upcoming'],
    ['Schedule', '#/schedule'], ['Help me pick', '#/pick'], ['A-Z', '#/az'], ['All filters', '#/search'], ['Random', '#/random']];
  app.innerHTML =
    '<h1 class="sr-only">animee space: watch anime</h1>' +
    spotlight(season.filter((x) => !store.notInterestedIds().has(String(x.id))).slice(0, 8)) +
    `<nav class="quick" aria-label="Shortcuts">${quick.map(([label, href]) => `<a class="chip" href="${href}">${label}</a>`).join('')}</nav>` +
    (cont.length ? section('Continue watching', '<div class="row">' + cont.map(contCard).join('') + '</div>') : '') +
    '<div id="picked"></div>' +
    shelf('shelf-top', 'Top 10 this season', 'what everyone is watching right now') +
    shelf('shelf-airing', 'Airing now', 'new episodes every week', '<a href="#/top/airing">See all ›</a>') +
    shelf('shelf-season', 'New this season', 'fresh starts worth a first episode', '<a href="#/top/season">See all ›</a>') +
    shelf('shelf-upcoming', 'Coming soon', 'mark your calendar', '<a href="#/top/upcoming">See all ›</a>') +
    shelf('shelf-completed', 'Just completed', 'finished, so you can binge it all', '<a href="#/top/completed">See all ›</a>') +
    shelf('shelf-popular', 'Most popular', 'the ones everybody has seen', '<a href="#/top/popular">See all ›</a>') +
    shelf('shelf-favorite', 'Fan favourites', 'crowd pleasers that never get old', '<a href="#/top/favorite">See all ›</a>') +
    '<section class="section" id="home-genres"></section>';

  app.querySelectorAll('.cont .x').forEach(b => b.onclick = e => {
    e.preventDefault();
    store.removeProgress(b.dataset.id);
    b.closest('.cont').remove();
  });
  bindSpotlight();
  checkNewEpisodes(cont, alive);
  bindShelf('shelf-top', async () => rankCards(unstarted(season).slice(0, 10)), alive);
  for (const name of ['airing', 'season', 'upcoming', 'completed', 'popular', 'favorite']) {
    bindShelf(`shelf-${name}`, async () => {
      const list = unstarted((await api(`/list/${name}`)).results || []).slice(0, 20);
      return list.length ? shelfCards(list) : '';
    }, alive);
  }

  // Recommendations based on the most recently watched or listed show.
  const recent = [...store.continueList(), ...Object.values(store.getList()).sort((x, y) => y.updated - x.updated)
    .map((e) => ({ animeId: e.id, title: e.title }))].find((e) => e.title);
  if (recent) api(`/anime/${recent.animeId}/extras`).then((x) => {
    if (!alive() || !x.recommendations?.length) return;
    const picked = document.getElementById('picked');
    picked.innerHTML = shelf('shelf-picked', `Because you watched ${esc(recent.title)}`, 'picked from what you watched');
    bindShelf('shelf-picked', async () => shelfCards(unstarted(x.recommendations).slice(0, 12)), alive);
  }).catch(() => {});

  api('/genres').then(({ genres }) => {
    if (!alive()) return;
    document.getElementById('home-genres').innerHTML = `<div class="section-head"><h2>Browse by genre</h2><a href="#/search">All filters ›</a></div>
      <div class="chips">${genres.map((g) => `<a class="chip" href="#/search?genres=${encodeURIComponent(g)}&order=score">${esc(g)}</a>`).join('')}</div>`;
  }).catch(() => {});
}

// For shows where the last opened episode is finished, check whether the next one is out.
function checkNewEpisodes(cont, alive) {
  for (const p of cont) {
    if (!store.watchedSet(p.animeId).has(p.ep)) continue;
    const next = p.ep + 1;
    api(`/anime/${p.animeId}/available?ep=${next}`).then((d) => {
      if (!alive() || !(d.sub || d.dub)) return;
      const cardEl = app.querySelector(`.cont[href^="#/watch/${p.animeId}?"]`);
      if (!cardEl) return;
      cardEl.href = `#/watch/${p.animeId}?ep=${next}`;
      const badge = cardEl.querySelector('.new-ep');
      badge.textContent = `Episode ${next} is out`;
      badge.hidden = false;
    }).catch(() => {});
  }
}

function bindSpotlight() {
  const root = app.querySelector('.spotlight');
  if (!root) return;
  const slides = [...root.querySelectorAll('.slide')];
  const dots = [...root.querySelectorAll('.dots button')];
  let i = 0;
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === i));
    dots.forEach((d, k) => { d.classList.toggle('on', k === i); d.setAttribute('aria-current', k === i); });
  };
  dots.forEach((d, k) => d.onclick = () => { show(k); restart(); });
  let timer = null;
  const restart = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 7000); };
  restart();
  root.onmouseenter = () => clearInterval(timer);
  root.onmouseleave = restart;
  onCleanup(() => clearInterval(timer));
}

// Spotlight art: AniList's wide banner when the show has one (sharp, no other service's logo),
// otherwise the cover as a blurred backdrop with the sharp poster beside it.
function spotlight(list) {
  if (!list?.length) return '';
  return `<section class="spotlight" aria-label="Spotlight">
    ${list.map((a, i) => `
      <div class="slide${i === 0 ? ' on' : ''}${a.backdrop ? ' has-art' : ''}">
        ${a.backdrop
          ? `<img class="slide-art" src="${esc(a.backdrop)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`
          : `<div class="slide-bg" style="background-image:url('${esc(a.cover)}')"></div>
        <img class="slide-poster" src="${esc(a.cover)}" alt="" ${i ? 'loading="lazy"' : ''}>`}
        <div class="slide-info">
          <div class="rank"><span>#${i + 1}</span> spotlight</div>
          <h2>${esc(T(a))}</h2>
          <div class="meta">
            ${a.format ? `<span>${FORMAT[a.format]}</span>` : ''}
            ${a.score ? `<span>★ ${score(a.score)}</span>` : ''}
            ${a.year ? `<span>${a.year}</span>` : ''}
            ${epsLabel(a) !== '?' ? `<span>${epsLabel(a)} eps</span>` : ''}
            ${a.genres.slice(0, 3).map((g) => `<span>${esc(g)}</span>`).join('')}
          </div>
          <p>${esc(a.description)}</p>
          <div class="actions">
            <a class="btn primary" href="#/watch/${a.id}">▶ Watch now</a>
            <a class="btn" href="#/anime/${a.id}">Details ›</a>
          </div>
        </div>
      </div>`).join('')}
    <div class="dots">${list.map((_, i) => `<button class="${i === 0 ? 'on' : ''}" aria-label="Slide ${i + 1}"></button>`).join('')}</div>
  </section>`;
}

function contCard(p) {
  const pct = p.duration ? Math.min(100, (p.time / p.duration) * 100) : 0;
  return `<a class="cont" href="#/watch/${p.animeId}?ep=${p.ep}">
    <img src="${esc(p.cover)}" alt="${esc(p.title)} poster" loading="lazy">
    <div style="min-width:0;flex:1">
      <div class="c-title">${esc(p.title)}</div>
      <div class="c-meta">Episode ${p.ep}</div>
      <span class="new-ep" hidden></span>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>
    <button class="x" data-id="${p.animeId}" aria-label="Remove">✕</button>
  </a>`;
}

function top10(list) {
  return `<div class="top10">${(list || []).map((a, i) => `
    <a href="#/anime/${a.id}">
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
  const heading = q.get('studioName') ? `${q.get('studioName')} anime` : q.get('q') ? 'Search results' : typeLabel ? `${typeLabel}${typeLabel.endsWith('s') ? '' : 's'}` : statusLabel || 'Browse anime';

  app.innerHTML = `
    <h1 class="page-title">${esc(heading)}</h1>
    <form class="filters" id="filters">
      ${q.get('studio') ? `<input type="hidden" name="studio" value="${esc(q.get('studio'))}"><input type="hidden" name="studioName" value="${esc(q.get('studioName') || '')}">` : ''}
      <div class="filter-row">
        <input class="input q" name="q" placeholder="Search titles…" value="${esc(q.get('q') || '')}" aria-label="Search titles">
        <button class="btn primary" type="submit">Search</button>
      </div>
      <div class="filter-grid">
        ${selectField('type', 'Type', TYPE_OPTIONS, q.get('type') || '', 'Any type')}
        ${selectField('status', 'Status', STATUS_OPTIONS, q.get('status') || '', 'Any status')}
        ${selectField('season', 'Season', SEASON_OPTIONS, q.get('season') || '', 'Any season')}
        ${selectField('year', 'Year', years, q.get('year') || '', 'Any year')}
        ${selectField('score', 'Score', [9, 8, 7, 6, 5].map((s) => [String(s), `${s} and up`]), q.get('score') || '', 'Any score')}
        ${selectField('rating', 'Age rating', RATING_OPTIONS, q.get('rating') || '', 'Any rating')}
        ${selectField('order', 'Sort by', ORDER_OPTIONS, q.get('order') || '', q.get('q') ? 'Best match' : 'Most popular')}
      </div>
      <details class="genre-picker"${picked.length ? ' open' : ''}>
        <summary>Genres <small class="card-meta">${picked.length ? esc(picked.join(', ')) : `pick up to ${MAX_GENRES}`}</small></summary>
        <div class="chips">${genres.map((g) => `<label class="chip check"><input type="checkbox" name="genres" value="${esc(g)}"${picked.includes(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('')}</div>
      </details>
      ${[...q.keys()].some((k) => k !== 'page') ? '<a class="link-btn" href="#/search">Clear all filters</a>' : ''}
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
    location.hash = '#/search' + (params.toString() ? '?' + params.toString() : '');
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
    return '#/search?' + p.toString();
  };
  const pager = (info.hasNextPage || page > 1) ? `
    <div class="pager">
      ${page > 1 ? '<a class="btn sm" href="' + pageLink(page - 1) + '">‹ Previous</a>' : ''}
      <span>Page ${page}${info.lastPage ? ' of ' + info.lastPage : ''}</span>
      ${info.hasNextPage ? '<a class="btn sm" href="' + pageLink(page + 1) + '">Next ›</a>' : ''}
    </div>` : '';
  document.getElementById('results').innerHTML = note +
    '<div class="section">' + (d.results?.length ? grid(d.results) : '<div class="empty"><h2>No matches found</h2><p>Try a different title or fewer filters.</p></div>') + '</div>' + pager;
}

// ---------- ranked lists ----------
async function viewList(name, alive) {
  if (!LIST_TITLES[name]) return viewNotFound();
  const d = await api(`/list/${name}?limit=25`);
  if (!alive()) return;
  document.title = `${LIST_TITLES[name]} · animee space`;
  const others = Object.keys(LIST_TITLES).filter((k) => k !== name);
  app.innerHTML = `<h1 class="page-title">${LIST_TITLES[name]}</h1>
    <div class="tabs">${[name, ...others].map((k) => `<a class="tab${k === name ? ' on' : ''}" href="#/top/${k}">${LIST_TITLES[k]}</a>`).join('')}</div>
    ${top10(d.results)}`;
}

// ---------- random ----------
async function viewRandom(alive) {
  const { id } = await api('/random', { fresh: true });
  if (alive()) location.replace(`#/anime/${id}?from=random`);
}

// ---------- anime details ----------
function bindShare(a) {
  const btn = document.getElementById('share');
  if (!btn) return;
  btn.onclick = async () => {
    const url = `${location.origin}/#/anime/${a.id}`;
    if (navigator.share) return navigator.share({ title: a.title, url }).catch(() => {});
    try { await navigator.clipboard.writeText(url); btn.textContent = 'Link copied'; } catch { prompt('Copy this link', url); }
  };
}

// The whole franchise in watching order, with the current title marked.
function loadSeasons(a, alive, slotId, linkTo = 'anime', onLoaded) {
  api(`/anime/${a.id}/seasons`).then(({ seasons }) => {
    const slot = document.getElementById(slotId);
    if (!alive() || !slot || seasons.length < 2) return;
    slot.innerHTML = `<section class="section seasons">
      <div class="section-head"><h2>Seasons and movies</h2></div>
      <p class="card-meta">${seasons.length} parts in watching order</p>
      <div class="season-row">${seasons.map((s, i) => {
        const here = s.id === String(a.id);
        return `<a class="season${here ? ' here' : ''}" href="#/${linkTo}/${s.id}"${here ? ' aria-current="page"' : ''}>
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
    if (chars && x.characters?.length) chars.innerHTML = section('Characters & voice actors', `<div class="chars">${x.characters.map((c) => `
      <div class="char">
        <div><img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy"><span>${esc(c.name)}<small>${esc(c.role)}</small></span></div>
        ${c.va ? `<div><img src="${esc(c.va.image)}" alt="${esc(c.va.name)}" loading="lazy"><span>${esc(c.va.name)}<small>Japanese</small></span></div>` : ''}
      </div>`).join('')}</div>`);
    const recs = slots.recs && document.getElementById(slots.recs);
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
function bindListButtons(a) {
  const fav = document.getElementById('fav-btn');
  const ni = document.getElementById('ni-btn');
  if (!fav || !ni) return;
  fav.onclick = () => {
    store.setFavourite(a, !store.getEntry(a.id)?.favourite);
    refreshListButtons(a);
  };
  ni.onclick = () => {
    const isNi = store.getEntry(a.id)?.status === 'notinterested';
    store.setEntry(a, isNi ? null : 'notinterested');
    refreshListButtons(a);
    const sel = document.getElementById('list-status');
    if (sel) { sel.outerHTML = listSelect(a); bindListSelect(a); }
  };
}

async function viewAnime(id, alive, query = new URLSearchParams()) {
  if (!id) return viewNotFound();
  const a = await api(`/anime/${id}`);
  if (!alive()) return;
  document.title = `${a.title} · animee space`;
  const prog = store.getProgress(a.id);
  const canWatch = a.availableEpisodes > 0;

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
            <span class="chip">${epsLabel(a)} eps</span>
            ${a.duration ? `<span class="chip">${a.duration} min</span>` : ''}
            ${canWatch ? '<span class="chip avail" id="avail-chip" hidden></span>' : ''}
            ${[...a.genres, ...(a.themes || [])].map((g) => `<a class="chip" href="#/search?genres=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
          </div>
          <div class="actions">
            ${canWatch
              ? `<a class="btn primary" href="#/watch/${a.id}${prog ? `?ep=${prog.ep}` : ''}">▶ ${prog ? `Continue EP ${prog.ep}` : 'Watch now'}</a>`
              : '<span class="btn" aria-disabled="true">Not released yet</span>'}
            ${listSelect(a)}
            ${listButtons(a)}
            <button class="btn" id="share" type="button">Share</button>
            ${query.get('from') === 'random' ? '<a class="btn" href="#/random">🎲 Another random</a>' : ''}
          </div>
          ${a.status === 'RELEASING' && nextBroadcast(a.broadcast) ? `<p class="card-meta" style="margin-top:12px">Next episode ${localTime(nextBroadcast(a.broadcast))}, in ${fmtCountdown(Math.round((nextBroadcast(a.broadcast) - Date.now()) / 1000))}</p>` : ''}
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
          <div class="info-box">
            <div><b>Aired</b><span>${fmtDate(a.startDate)} – ${a.status === 'RELEASING' ? 'now' : fmtDate(a.endDate)}</span></div>
            ${a.season ? `<div><b>Season</b><span>${SEASON[a.season]} ${a.year || ''}</span></div>` : ''}
            ${a.studios.length ? `<div><b>Studio</b><span>${(a.studioLinks?.length ? a.studioLinks.map((st) => `<a href="#/search?studio=${st.id}&studioName=${encodeURIComponent(st.name)}">${esc(st.name)}</a>`) : a.studios.map(esc)).join(', ')}</span></div>` : ''}
            ${a.source ? `<div><b>Source</b><span>${esc(a.source.replace(/_/g, ' ').toLowerCase())}</span></div>` : ''}
            ${a.popularity ? `<div><b>Members</b><span>${a.popularity.toLocaleString()}</span></div>` : ''}
            ${a.synonyms.length ? `<div><b>Also</b><span>${esc(a.synonyms.slice(0, 3).join(', '))}</span></div>` : ''}
          </div>
        </section>
        ${a.streamingLinks.length ? section('Official streams', `<div class="links">${a.streamingLinks.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ↗</a>`).join('')}</div>`) : ''}
      </aside>
    </div>`;

  bindListSelect(a);
  bindListButtons(a);
  bindShare(a);
  loadExtras(a.id, alive, { chars: 'extras-chars', recs: 'extras-recs' });
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
  const [a, epData] = await Promise.all([api(`/anime/${id}`), api(`/anime/${id}/episodes`)]);
  if (!alive()) return;
  document.title = `Watch ${a.title} · animee space`;
  const episodes = epData.episodes;

  if (!episodes.length) {
    app.innerHTML = `<div class="empty"><h2>No episodes yet</h2><p>${esc(T(a))} hasn't released any episodes.</p>
      <a class="btn" href="#/anime/${a.id}">Back to details</a></div>`;
    return;
  }

  const settings = store.getSettings();
  const prog = store.getProgress(a.id);
  const wantEp = Number(query.get('ep')) || prog?.ep || 1;
  let current = episodes.find((e) => e.number === wantEp) || episodes[0];
  let servers = [];
  let server = null; // { id, category }
  const watched = store.watchedSet(a.id);
  const wide = episodes.length <= 30 && episodes.some((e) => e.title && !/^Episode \d+$/.test(e.title));
  const CHUNK = 100;
  // Availability is determined by the configured providers for each episode.
  // Do not disable an episode based on MegaPlay-only availability when other servers exist.
  const playable = () => true;
  const fillerCount = episodes.filter((e) => e.isFiller).length;
  const recapCount = episodes.filter((e) => e.isRecap).length;

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/anime/${a.id}">${esc(T(a))}</a> › <span id="crumb-ep"></span></div>
    <div class="watch-grid">
      <div>
        <div class="player-wrap">
          <div id="player"></div>
          <div class="pl-bar">
            <label><input type="checkbox" id="opt-autoplay" ${settings.autoplay ? 'checked' : ''}> Auto next</label>
            ${fillerCount || recapCount ? `<label title="Auto next skips filler and recap episodes"><input type="checkbox" id="opt-skipfiller" ${settings.skipFiller ? 'checked' : ''}> Skip filler</label>` : ''}
            <span class="card-meta player-hint">Pause, seek and quality controls are inside the player.</span>
            <span class="spacer"></span>
            <button class="btn sm wide-btn" id="wide-toggle" type="button" aria-pressed="false">⤢ Wide player</button>
            <button class="btn sm" id="mark-seen" type="button">✓ Mark watched</button>
            <button class="btn sm" id="prev-ep">‹ Prev</button>
            <button class="btn sm" id="next-ep">Next ›</button>
          </div>
        </div>
        <div class="servers">
          <div class="now">You are watching<b id="now-ep"></b>If one server doesn't work, try another.</div>
          <div id="server-list"></div>
        </div>
        <section class="section">
          <div style="display:flex;gap:18px;align-items:flex-start">
            <img src="${esc(a.cover)}" alt="" style="width:110px;border-radius:10px">
            <div>
              <h2 style="margin:0 0 6px"><a href="#/anime/${a.id}">${esc(T(a))}</a></h2>
              <div class="chips" style="margin:6px 0 10px">
                ${a.score ? `<span class="chip">★ ${score(a.score)}</span>` : ''}
                ${a.format ? `<span class="chip">${FORMAT[a.format]}</span>` : ''}
                <span class="chip">${STATUS[a.status] || ''}</span>
              </div>
              <div class="desc clamp">${esc(a.description || '')}</div>
              <div style="margin-top:12px">${listSelect(a)}</div>
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
            ${episodes.length > CHUNK ? `<select id="ep-range">${Array.from({ length: Math.ceil(episodes.length / CHUNK) }, (_, i) => {
              const from = i * CHUNK + 1, to = Math.min((i + 1) * CHUNK, episodes.length);
              return `<option value="${i}">${from}-${to}</option>`;
            }).join('')}</select>` : ''}
            <input class="input" id="ep-find" type="number" min="1" max="${episodes.length}" placeholder="EP #">
          </div>
          <div class="ep-list${wide ? ' wide' : ''}" id="ep-list"></div>
          ${fillerCount || recapCount ? `<div class="ep-legend">Filler guide: <span class="lg filler">${fillerCount} filler</span>${recapCount ? ` · <span class="lg recap">${recapCount} recap</span>` : ''} · <span class="lg canon">${episodes.length - fillerCount - recapCount} story</span></div>` : ''}
        </div>
      </aside>
    </div>`;

  bindListSelect(a);
  const $ = (sel) => document.getElementById(sel);
  const idx = () => episodes.indexOf(current);
  // Next episode for auto next: playable, and not filler or recap when "Skip filler" is on.
  const nextAuto = () => {
    const skip = store.getSettings().skipFiller;
    return episodes.slice(idx() + 1).find((e) => playable(e) && !(skip && (e.isFiller || e.isRecap))) || null;
  };

  const player = new Player($('player'), {
    autoskip: () => store.getSettings().autoskip,
    hasNext: () => !!nextAuto(),
    onNext: () => goTo(nextAuto()),
    onEnded: () => {
      store.markWatched(a.id, current.number);
      watched.add(current.number);
      if (store.getSettings().autoplay && nextAuto()) goTo(nextAuto());
      else renderEpisodes();
    },
    onProgress: ({ time, duration, ep }) => {
      store.saveProgress({ animeId: a.id, ep, time, duration, title: a.title, cover: a.cover });
      if (duration && time / duration > 0.85 && !watched.has(ep)) {
        store.markWatched(a.id, ep);
        watched.add(ep);
        showSeen();
      }
    },
  });
  onCleanup(() => player.destroy());

  $('opt-autoplay').onchange = (e) => store.setSetting('autoplay', e.target.checked);
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
  $('next-ep').onclick = () => idx() < episodes.length - 1 && goTo(episodes[idx() + 1]);

  let range = Math.floor(idx() / CHUNK);
  function renderEpisodes() {
    const slice = episodes.length > CHUNK ? episodes.slice(range * CHUNK, (range + 1) * CHUNK) : episodes;
    $('ep-list').innerHTML = slice.map((e) => `
      <button class="ep${e === current ? ' on' : ''}${watched.has(e.number) ? ' seen' : ''}${e.isFiller ? ' filler' : ''}${e.isRecap ? ' recap' : ''}${playable(e) ? '' : ' na'}"
        data-n="${e.number}" title="${esc(e.title)}${e.isFiller ? ' (filler)' : e.isRecap ? ' (recap)' : ''}${playable(e) ? '' : ' (not available yet)'}">${wide ? `${e.number}. ${esc(e.title)}` : e.number}</button>`).join('');
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
      return `<div class="srv-row"><span class="lab">${cat}</span>${list.map((s) => `
        <button class="srv${server && server.id === s.id && server.category === cat ? ' on' : ''}" data-id="${esc(s.id)}" data-cat="${cat}"${playable(current, cat) ? '' : ` disabled title="Not out in ${cat} for this episode yet"`}>${esc(s.name)}</button>`).join('')}</div>`;
    }).join('');
    $('server-list').innerHTML = groups || '<span class="card-meta">No servers available.</span>';
  }
  $('server-list').onclick = (e) => {
    const b = e.target.closest('.srv');
    if (!b) return;
    server = { id: b.dataset.id, category: b.dataset.cat };
    store.setSetting('category', server.category);
    store.setSetting('provider', server.id);
    renderServers();
    playSource(player.getCurrentTime());
  };

  async function playSource(startAt) {
    const ep = current;
    try {
      const src = await api(`/episode/${encodeURIComponent(ep.id)}/sources?server=auto&preferred=${encodeURIComponent(server.id)}&category=${server.category}`, { fresh: true });
      if (!alive() || ep !== current) return;
      // Reflect the provider that actually resolved, not merely the first one tried.
      if (src.provider) {
        const resolved = servers.find((item) => item.id === src.provider && item.category === server.category);
        if (resolved) server = { id: resolved.id, category: resolved.category };
        renderServers();
      }
      player.load(src, { startAt, meta: { ep: ep.number } });
    } catch (err) {
      if (alive()) player.msg(`Couldn't load the video: ${err.message}`);
    }
  }

  async function goTo(ep) {
    if (!ep) return;
    current = ep;
    range = Math.floor(idx() / CHUNK);
    history.replaceState(null, '', `#/watch/${a.id}?ep=${ep.number}`);
    $('crumb-ep').textContent = `Episode ${ep.number}`;
    $('now-ep').textContent = `Episode ${ep.number}${ep.isFiller ? ' (filler)' : ''}`;
    $('prev-ep').disabled = idx() === 0;
    $('next-ep').disabled = idx() === episodes.length - 1;
    store.addHistory({ animeId: a.id, ep: ep.number, title: a.title, cover: a.cover });
    showSeen();
    renderEpisodes();
    player.reset();
    $('server-list').innerHTML = '<span class="card-meta">Loading servers…</span>';
    try {
      const data = await api(`/episode/${encodeURIComponent(ep.id)}/servers`);
      if (!alive() || ep !== current) return;
      servers = data.servers;
      const prefs = store.getSettings();
      const pref = prefs.category;
      const preferredProvider = prefs.provider || 'megaplay';
      const s = servers.find((x) => x.id === preferredProvider && x.category === pref)
        || servers.find((x) => x.category === pref)
        || servers[0];
      server = s ? { id: s.id, category: s.category } : null;
      renderServers();
      if (!server) return player.msg('No playback servers are configured for this episode.');
      if (s.category !== pref) $('now-ep').textContent += ` · ${pref} isn't out yet, playing ${s.category}`;
      const p = store.getProgress(a.id);
      await playSource(p && p.ep === ep.number ? p.time : 0);
    } catch (err) {
      if (alive()) player.msg(`Couldn't load servers: ${err.message}`);
    }
  }

  goTo(current);
}

// ---------- watchlist ----------
// Long lists (for example after an import) are shown 60 at a time.
const LIST_PAGE = 60;
const asCard = (e) => ({ ...e, availableEpisodes: e.episodes });
const LIST_SORTS = [['recent', 'Last changed first'], ['oldest', 'First changed first'], ['title', 'Title A-Z'], ['year', 'Newest year']];
function viewWatchlist(query) {
  document.title = 'Watchlist · animee space';
  const ids = Object.keys(store.getList());
  store.ensureMeta(ids).then((changed) => { if (changed && parseHash().parts[0] === 'watchlist') route(); });
  const list = Object.values(store.getList()).filter((e) => e.title);
  const tab = query.get('tab') || 'all';
  const count = (k) => list.filter((e) => e.status === k).length;
  const inAll = (e) => e.status && e.status !== 'notinterested';
  const favCount = list.filter((e) => e.favourite).length;
  const opened = store.getHistory();
  const tabs = `<div class="tabs">
      <a class="tab${tab === 'all' ? ' on' : ''}" href="#/watchlist">All <small>${list.filter(inAll).length}</small></a>
      ${store.LIST_STATUSES.map(([k, l]) => `<a class="tab${tab === k ? ' on' : ''}" href="#/watchlist?tab=${k}">${l} <small>${count(k)}</small></a>`).join('')}
      <a class="tab${tab === 'favourites' ? ' on' : ''}" href="#/watchlist?tab=favourites">♥ Favourites <small>${favCount}</small></a>
      <a class="tab${tab === 'history' ? ' on' : ''}" href="#/watchlist?tab=history">History <small>${opened.length}</small></a>
    </div>`;
  const signInNote = !store.currentUser() ? '<p class="card-meta" style="text-align:center;margin-top:24px"><a href="#/account" style="color:var(--accent)">Sign in</a> to sync your list across devices.</p>' : '';

  if (tab === 'history') {
    app.innerHTML = `<h1 class="page-title">My watchlist</h1>${tabs}
      <p class="card-meta">Every episode you opened in this browser, newest first. History stays on this device.</p>
      ${opened.length ? `<div class="sched">${opened.map((h) => `
        <a class="sched-row" href="#/watch/${h.animeId}?ep=${h.ep}">
          <img src="${esc(h.cover)}" alt="${esc(h.title)} poster" loading="lazy">
          <span class="sched-info"><span class="t">${esc(h.title)}</span>
            <span class="card-meta">Episode ${h.ep} · ${new Date(h.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
        </a>`).join('')}</div>
        <p style="margin-top:16px"><button class="link-btn" id="clear-history" type="button">Clear history</button></p>`
        : '<div class="empty"><h2>No history yet</h2><p>Episodes you open show up here.</p></div>'}`;
    const clear = document.getElementById('clear-history');
    if (clear) clear.onclick = () => { if (confirm('Clear your watch history in this browser?')) { store.clearHistory(); route(); } };
    return;
  }

  const term = (query.get('q') || '').trim().toLowerCase();
  const type = query.get('type') || '';
  const sort = LIST_SORTS.some(([k]) => k === query.get('sort')) ? query.get('sort') : 'recent';
  const sorters = {
    recent: (x, y) => y.updated - x.updated,
    oldest: (x, y) => x.updated - y.updated,
    title: (x, y) => String(x.title).localeCompare(String(y.title)),
    year: (x, y) => (y.year || 0) - (x.year || 0),
  };
  const shown = list
    .filter((e) => (tab === 'all' ? inAll(e) : tab === 'favourites' ? e.favourite : e.status === tab) && (!type || String(e.format || '').toLowerCase() === type) && (!term || String(e.title).toLowerCase().includes(term)))
    .sort(sorters[sort]);
  const types = [...new Set(list.map((e) => String(e.format || '').toLowerCase()).filter(Boolean))].sort();

  app.innerHTML = `
    <h1 class="page-title">My watchlist</h1>
    ${tabs}
    <form class="filters list-filters" id="list-filters">
      <div class="filter-row"><input class="input q" type="search" name="q" placeholder="Search my list…" value="${esc(query.get('q') || '')}" aria-label="Search my list"></div>
      <div class="filter-grid">
        ${selectField('type', 'Type', types.map((t) => [t, FORMAT[t.toUpperCase()] || t]), type, 'Any type')}
        ${selectField('sort', 'Sort by', LIST_SORTS, sort, 'Last changed first')}
      </div>
    </form>
    ${shown.length ? `<p class="card-meta">${shown.length.toLocaleString()} show${shown.length === 1 ? '' : 's'}</p>${grid(shown.slice(0, LIST_PAGE).map(asCard))}
      ${shown.length > LIST_PAGE ? '<div class="pager"><button class="btn" id="list-more" type="button">Show more</button></div>' : ''}`
      : list.length ? '<div class="empty"><p>Nothing on your list matches.</p></div>'
      : `<div class="empty"><h2>Nothing here yet</h2><p>Add anime from any details page, or bring your list from AniList or MyAnimeList in <a href="#/settings" style="color:var(--accent)">Settings</a>.</p><a class="btn" href="#/search">Browse anime</a></div>`}
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
    history.replaceState(null, '', '#/watchlist' + (p.toString() ? '?' + p : ''));
    route();
  };
  form.onsubmit = (e) => { e.preventDefault(); apply(); };
  form.querySelectorAll('select').forEach((s) => s.onchange = apply);
  let timer;
  form.elements.q.oninput = () => { clearTimeout(timer); timer = setTimeout(apply, 350); };
  if (term) { const box = form.elements.q; box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
}

// ---------- account ----------
function viewAccount(query) {
  document.title = 'Account · animee space';
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
        <label class="card-meta" style="display:flex;gap:8px;margin-top:14px;cursor:pointer">
          <input type="checkbox" id="clear-local"> Also clear the list and history saved in this browser when signing out
        </label>
      </div>`;
    document.getElementById('sync-now').onclick = async (e) => {
      e.target.disabled = true;
      await store.sync.pull().catch(() => {});
      route();
    };
    const out = (everywhere) => async () => {
      await store.logout({ everywhere, clearLocal: document.getElementById('clear-local').checked });
      location.hash = '#/';
    };
    document.getElementById('logout').onclick = out(false);
    document.getElementById('logout-all').onclick = out(true);
    return;
  }

  const mode = query.get('mode') === 'register' ? 'register' : 'login';
  app.innerHTML = `
    <div class="auth-box">
      <div class="tabs" style="margin-top:0">
        <a class="tab${mode === 'login' ? ' on' : ''}" href="#/account">Sign in</a>
        <a class="tab${mode === 'register' ? ' on' : ''}" href="#/account?mode=register">Create account</a>
      </div>
      <form id="auth-form" class="auth-form">
        <label>Username<input class="input" name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+"></label>
        <label>Password<input class="input" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="8" maxlength="128"></label>
        <div class="auth-err" id="auth-err" hidden></div>
        <button class="btn primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        <p class="card-meta">${mode === 'login' ? 'No account yet? <a href="#/account?mode=register" style="color:var(--accent)">Create one</a>' : 'No email needed. Anything you already watched in this browser gets added to your account.'}</p>
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
      location.hash = '#/';
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
  return `<a class="sched-row" href="#/anime/${a.id}">
    <span class="sched-time"><b>${esc(a.broadcast?.time || '?')}</b><small>JST</small></span>
    <img src="${esc(a.cover)}" alt="${esc(T(a))} poster" loading="lazy">
    <span class="sched-info"><span class="t">${esc(T(a))}</span>
      <span class="card-meta">${[FORMAT[a.format], a.score ? `★ ${score(a.score)}` : '', note].filter(Boolean).join(' · ')}</span></span>
  </a>`;
}
async function viewSchedule(query, alive) {
  document.title = 'Schedule · animee space';
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
  const link = (o, m = mine) => `#/schedule?d=${o}${m ? '&mine=1' : ''}`;
  const myIds = new Set(store.libraryIds());

  app.innerHTML = `<h1 class="page-title">Airing schedule</h1>
    <p class="card-meta">Days follow Japan time. Each show also lists when it airs where you are.</p>
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
    .sort((x, y) => String(x.broadcast?.time || '99').localeCompare(String(y.broadcast?.time || '99')));
  document.getElementById('sched').innerHTML = rows.length ? `<div class="sched">${rows.map((a) => {
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
  document.title = 'A-Z list · animee space';
  const letter = LETTERS.includes((query.get('letter') || '').toUpperCase()) ? query.get('letter').toUpperCase() : '';
  const page = Math.max(1, Number(query.get('page')) || 1);
  app.innerHTML = `<h1 class="page-title">${letter ? `Anime starting with ${letter}` : 'Anime A-Z'}</h1>
    <p class="card-meta">Know the name but not the spelling? Jump to its first letter.</p>
    <nav class="az-bar" aria-label="Letters">
      <a class="chip${letter ? '' : ' on'}" href="#/az">All</a>
      ${LETTERS.map((l) => `<a class="chip${l === letter ? ' on' : ''}" href="#/az?letter=${l}">${l}</a>`).join('')}
    </nav>
    <div id="az-results">${loader()}</div>`;
  const params = new URLSearchParams({ order: 'title', page: String(page) });
  if (letter) params.set('letter', letter);
  const d = await api('/search?' + params);
  if (!alive()) return;
  const info = d.pageInfo || {};
  const pageLink = (n) => `#/az?${letter ? `letter=${letter}&` : ''}page=${n}`;
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
const MOODS = [
  ['laugh', 'Make me laugh', ['Comedy']], ['romance', 'Something romantic', ['Romance']], ['fights', 'Big fights', ['Action']],
  ['cozy', 'Calm and cozy', ['Iyashikei']], ['guessing', 'Keep me guessing', ['Mystery']], ['scare', 'Scare me', ['Horror']],
  ['isekai', 'Another world', ['Isekai']], ['cry', 'Make me cry', ['Drama']], ['sports', 'Sports and teamwork', ['Sports']],
];
const LENGTHS = [['short', 'Short, up to 13 episodes', 1, 13], ['mid', 'One or two seasons, 14 to 26', 14, 26], ['long', 'Long, more than 26', 27, 99999]];
const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

async function viewPick(alive) {
  document.title = 'Help me pick · animee space';
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
      <fieldset><legend>3. An anime you already like</legend>
        <div class="pick-like">
          <input class="input" type="search" id="like-q" placeholder="Type a title…" autocomplete="off" aria-label="An anime you already like">
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
      if (length) candidates = candidates.filter((a) => a.episodes && a.episodes >= length[2] && a.episodes <= length[3]);
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
  document.title = 'Settings · animee space';
  const s = store.getSettings();
  const user = store.currentUser();
  const radio = (name, value, label, current) => `<label class="chip check"><input type="radio" name="${name}" value="${value}"${current === value ? ' checked' : ''}> ${label}</label>`;
  const toggle = (name, label, on) => `<label class="setting-toggle"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
  app.innerHTML = `<h1 class="page-title">Settings</h1>
    <p class="card-meta">Saved in this browser.${user ? ` Signed in as <b>${esc(user.name)}</b>: your list and playback choices also sync to your account.` : ' <a href="#/account" style="color:var(--accent)">Sign in</a> to sync your list across devices.'}</p>
    <form id="settings" class="settings">
      <section class="settings-group"><h2>Display</h2>
        <div class="setting"><span>Anime names in</span><div class="chips">${radio('titles', 'english', 'English', s.titles)}${radio('titles', 'japanese', 'Japanese', s.titles)}</div></div>
      </section>
      <section class="settings-group"><h2>Home page</h2>
        ${toggle('showContinue', 'Show Continue watching on the home page', s.showContinue)}
        ${toggle('hideStarted', 'Hide shows I already started from the home rows and picks', s.hideStarted)}
      </section>
      <section class="settings-group"><h2>Player</h2>
        <div class="setting"><span>Audio I prefer</span><div class="chips">${radio('category', 'sub', 'Sub', s.category)}${radio('category', 'dub', 'Dub', s.category)}</div></div>
        ${toggle('autoplay', 'Play the next episode automatically', s.autoplay)}
        ${toggle('skipFiller', 'Skip filler and recap episodes when playing the next one', !!s.skipFiller)}
        ${toggle('wide', 'Use the wide player', !!s.wide)}
      </section>
    </form>

    <section class="settings-group" id="install-group"><h2>Install the app</h2>
      <p class="card-meta">Add animee space to your phone or computer and open it like an app, full screen and one tap away. No app store needed.</p>
      <button class="btn" id="install" type="button">Install the app</button>
      <p class="card-meta" id="install-note"></p>
    </section>

    <section class="settings-group"><h2>Bring your list</h2>
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
      <button class="link-btn" id="clear-history" type="button">Clear watch history</button>
    </section>`;

  // Settings apply as soon as they change.
  const form = document.getElementById('settings');
  form.onchange = (e) => {
    const el = e.target;
    store.setSetting(el.name, el.type === 'checkbox' ? el.checked : el.value);
  };

  // Install: browsers that support it fire beforeinstallprompt; iPhone and iPad need the Share menu.
  const installBtn = document.getElementById('install');
  const installNote = document.getElementById('install-note');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) { installBtn.hidden = true; installNote.textContent = 'You are already using the installed app.'; }
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { installBtn.hidden = true; installNote.textContent = 'On iPhone or iPad: tap Share in Safari, then Add to Home Screen.'; }
  installBtn.onclick = async () => {
    if (!installPrompt) { installNote.textContent = 'Your browser doesn\'t offer installing right now. In Chrome or Edge, use the install icon in the address bar, or the menu, then Install animee space.'; return; }
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    installPrompt = null;
    installNote.textContent = outcome === 'accepted' ? 'Installed. You can open animee space from your home screen or apps.' : '';
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
      const d = await api('/import/anilist?user=' + encodeURIComponent(f.get('user')), { fresh: true });
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
    a.download = `animee-space-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  app.innerHTML = '<div class="empty lost" data-kao="-_-."><h2>404, this page wandered off</h2><p>The link is broken or the page never existed.</p><a class="btn primary" href="#/">Take me home</a></div>';
}

// ---------- nav search with suggestions ----------
function setupSearch() {
  const form = document.getElementById('nav-search');
  const input = form.querySelector('input');
  const box = document.getElementById('suggest');
  let timer = null;
  let seq = 0;

  form.onsubmit = (e) => {
    e.preventDefault();
    const q = input.value.trim();
    box.hidden = true;
    input.blur();
    if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
  };
  input.oninput = () => {
    clearTimeout(timer);
    const q = input.value.trim();
    const my = ++seq;
    if (q.length < 3) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const d = await api('/search?q=' + encodeURIComponent(q));
        if (my !== seq) return;
        const results = Array.isArray(d.results) ? d.results : [];
        box.innerHTML = (results.length ? results.slice(0, 5).map((a) => `
          <a href="#/anime/${a.id}"><img src="${esc(a.cover)}" alt="">
            <div><div class="s-title">${esc(T(a))}</div><div class="s-meta">${[FORMAT[a.format], a.year, STATUS[a.status]].filter(Boolean).join(' · ')}</div></div></a>`).join('') : '<div class="s-empty">No matches found.</div>') +
          `<a class="s-all" href="#/search?q=${encodeURIComponent(q)}">View all results ›</a>`;
        box.hidden = false;
      } catch { if (my === seq) box.hidden = true; }
    }, 450);
  };
  const close = () => { clearTimeout(timer); seq++; box.hidden = true; };
  box.onclick = () => { close(); input.value = ''; };
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  // Any route change (a picked result, Back, a link elsewhere) closes the list.
  window.addEventListener('hashchange', close);
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
document.getElementById('menu-btn').onclick = () => document.getElementById('nav-links').classList.toggle('open');
setupSearch();
window.addEventListener('hashchange', () => { document.title = 'animee space'; route(); });

// account label in the nav + refresh list pages after the first sync
const navAccount = document.getElementById('nav-account');
let firstSync = true;
store.onSyncChange(({ user, synced }) => {
  navAccount.textContent = user ? user.name : 'Sign in';
  if (synced && firstSync) {
    firstSync = false;
    const page = parseHash().parts[0];
    if (page === undefined || page === 'watchlist') route(); // never interrupt the player
  }
});

route();
store.initAccount();
