import { api } from './api.js';
import * as store from './store.js';
import { Player } from './player.js';

const app = document.getElementById('app');
let cleanups = [];
let navToken = 0;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMAT = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' };
const STATUS = { RELEASING: 'Airing', FINISHED: 'Finished', NOT_YET_RELEASED: 'Upcoming', CANCELLED: 'Cancelled', HIATUS: 'Hiatus' };
const SEASON = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };
const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery',
  'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'];
const score = (s) => (s ? (s / 10).toFixed(1) : null);
const fmtDate = (d) => (d?.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', ...(d.day ? { day: 'numeric' } : {}) }) : '?');
const fmtCountdown = (sec) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const loader = () => '<div class="loader"></div>';
const onCleanup = (fn) => cleanups.push(fn);

function epsLabel(a) {
  const have = Number(a.availableEpisodes ?? a.episodes) || 0;
  
  return have || a.episodes || '?';
}

function card(a) {
  return `<a class="card" href="#/anime/${a.id}" title="${esc(a.title)}">
    <div class="poster" style="--c:${esc(a.color || '#1e1a2b')}">
      <img loading="lazy" src="${esc(a.cover)}" alt="">
      ${a.score ? `<span class="badge score">★ ${score(a.score)}</span>` : ''}
      ${a.status === 'RELEASING' ? '<span class="badge airing">Airing</span>' : ''}
      <span class="badge eps">${FORMAT[a.format] === 'Movie' ? 'Movie' : `${epsLabel(a)} eps`}</span>
    </div>
    <div class="card-title">${esc(a.title)}</div>
    <div class="card-meta">${[FORMAT[a.format], a.year].filter(Boolean).join(' · ')}</div>
  </a>`;
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

  try {
    switch (parts[0]) {
      case undefined: return await viewHome(alive);
      case 'search': return await viewSearch(query, alive);
      case 'anime': return await viewAnime(parts[1], alive);
      case 'watch': return await viewWatch(parts[1], query, alive);
      case 'watchlist': return viewWatchlist(query);
      case 'schedule': return await viewSchedule(query, alive);
      case 'account': return viewAccount(query);
      default: return viewNotFound();
    }
  } catch (err) {
    if (!alive()) return;
    app.innerHTML = `<div class="error"><h2>Couldn't load this page</h2><p>${esc(err.message)}</p>
      <button class="btn" id="retry">Try again</button></div>`;
    document.getElementById('retry').onclick = route;
  }
}

// ---------- home ----------
async function viewHome(alive) {
  const d = await api('/home');
  if (!alive()) return;
  const cont = store.continueList().filter(p => p.title);
  app.innerHTML =
    (cont.length ? section('Continue watching', '<div class="row">' + cont.map(contCard).join('') + '</div>') : '') +
    section('Trending now', grid(d.recent), '<a href="#/search">Browse catalog ›</a>');
  app.querySelectorAll('.cont .x').forEach(b => b.onclick = e => {
    e.preventDefault();
    store.removeProgress(b.dataset.id);
    b.closest('.cont').remove();
  });
}

function spotlight(list) {
  if (!list?.length) return '';
  return `<section class="spotlight">
    ${list.map((a, i) => `
      <div class="slide${i === 0 ? ' on' : ''}">
        <img src="${esc(a.banner)}" alt="" ${i ? 'loading="lazy"' : ''}>
        <div class="slide-info">
          <div class="rank">#${i + 1} Spotlight</div>
          <h1>${esc(a.title)}</h1>
          <div class="meta">
            ${a.format ? `<span>${FORMAT[a.format]}</span>` : ''}
            ${a.score ? `<span>★ ${score(a.score)}</span>` : ''}
            ${a.year ? `<span>${a.year}</span>` : ''}
            <span>${epsLabel(a)} eps</span>
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
    <img src="${esc(p.cover)}" alt="" loading="lazy">
    <div style="min-width:0;flex:1">
      <div class="c-title">${esc(p.title)}</div>
      <div class="c-meta">Episode ${p.ep}</div>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
    </div>
    <button class="x" data-id="${p.animeId}" aria-label="Remove">✕</button>
  </a>`;
}

function top10(list) {
  return `<div class="top10">${(list || []).map((a, i) => `
    <a href="#/anime/${a.id}">
      <span class="num">${String(i + 1).padStart(2, '0')}</span>
      <img src="${esc(a.cover)}" alt="" loading="lazy">
      <div><div class="t">${esc(a.title)}</div><div class="m">${[FORMAT[a.format], a.score ? `★ ${score(a.score)}` : ''].filter(Boolean).join(' · ')}</div></div>
    </a>`).join('')}</div>`;
}

// ---------- search / browse ----------
async function viewSearch(q, alive) {
  const selectedGenre = q.get('genre') || '';
  const options = GENRES.map(g => '<option value="' + esc(g) + '"' + (g === selectedGenre ? ' selected' : '') + '>' + esc(g) + '</option>').join('');
  app.innerHTML = `
    <h1 class="page-title">${q.get('q') ? 'Search results' : 'Browse anime'}</h1>
    <form class="filters" id="filters">
      <input class="input q" name="q" placeholder="Search titles…" value="${esc(q.get('q') || '')}">
      <select name="genre"><option value="">All genres</option>${options}</select>
      <button class="btn primary" type="submit">Search</button>
    </form>
    <div id="results">${loader()}</div>`;
  const form = document.getElementById('filters');
  form.onsubmit = e => {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (String(value).trim()) params.set(key, String(value).trim());
    location.hash = '#/search' + (params.toString() ? '?' + params.toString() : '');
  };
  const params = new URLSearchParams(q);
  const d = await api('/search?' + params.toString());
  if (!alive()) return;
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
  document.getElementById('results').innerHTML =
    '<div class="section">' + (d.results?.length ? grid(d.results) : '<div class="empty"><h2>No matches found</h2><p>Try a different title or genre.</p></div>') + '</div>' + pager;
}

// ---------- anime details ----------
function listSelect(a) {
  const entry = store.getEntry(a.id);
  return `<select id="list-status" aria-label="Watchlist">
    <option value="">${entry ? 'Remove from list' : '＋ Add to list'}</option>
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
  };
}

async function viewAnime(id, alive) {
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
          <h1>${esc(a.title)}</h1>
          <div class="alt">${esc([a.titleRomaji !== a.title ? a.titleRomaji : null, a.titleNative].filter(Boolean).join(' · '))}</div>
          <div class="chips">
            ${a.score ? `<span class="chip">★ ${score(a.score)}</span>` : ''}
            ${a.format ? `<span class="chip">${FORMAT[a.format]}</span>` : ''}
            <span class="chip">${STATUS[a.status] || a.status}</span>
            <span class="chip">${epsLabel(a)} eps</span>
            ${a.duration ? `<span class="chip">${a.duration} min</span>` : ''}
            ${a.genres.map((g) => `<a class="chip" href="#/search?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
          </div>
          <div class="actions">
            ${canWatch
              ? `<a class="btn primary" href="#/watch/${a.id}${prog ? `?ep=${prog.ep}` : ''}">▶ ${prog ? `Continue EP ${prog.ep}` : 'Watch now'}</a>`
              : '<span class="btn" aria-disabled="true">Not released yet</span>'}
            ${listSelect(a)}
          </div>
          ${a.nextAiring ? `<p class="card-meta" style="margin-top:12px">Episode ${a.nextAiring.episode} airs in ${fmtCountdown(a.nextAiring.timeUntilAiring)}</p>` : ''}
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
        ${a.characters.length ? section('Characters & voice actors', `<div class="chars">${a.characters.map((c) => `
          <div class="char">
            <div><img src="${esc(c.image)}" alt="" loading="lazy"><span>${esc(c.name)}<small>${esc(c.role)}</small></span></div>
            ${c.va ? `<div><img src="${esc(c.va.image)}" alt="" loading="lazy"><span>${esc(c.va.name)}<small>Japanese</small></span></div>` : ''}
          </div>`).join('')}</div>`) : ''}
        ${a.relations.length ? section('Related', grid(a.relations)) : ''}
        ${a.recommendations.length ? section('You might also like', grid(a.recommendations)) : ''}
      </div>
      <aside>
        <section class="section" style="margin-top:12px">
          <div class="info-box">
            <div><b>Aired</b><span>${fmtDate(a.startDate)} – ${a.status === 'RELEASING' ? 'now' : fmtDate(a.endDate)}</span></div>
            ${a.season ? `<div><b>Season</b><span>${SEASON[a.season]} ${a.year || ''}</span></div>` : ''}
            ${a.studios.length ? `<div><b>Studio</b><span>${esc(a.studios.join(', '))}</span></div>` : ''}
            ${a.source ? `<div><b>Source</b><span>${esc(a.source.replace(/_/g, ' ').toLowerCase())}</span></div>` : ''}
            ${a.popularity ? `<div><b>Members</b><span>${a.popularity.toLocaleString()}</span></div>` : ''}
            ${a.synonyms.length ? `<div><b>Also</b><span>${esc(a.synonyms.slice(0, 3).join(', '))}</span></div>` : ''}
          </div>
        </section>
        ${a.streamingLinks.length ? section('Official streams', `<div class="links">${a.streamingLinks.map((l) => `<a class="chip" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.site)} ↗</a>`).join('')}</div>`) : ''}
      </aside>
    </div>`;

  bindListSelect(a);
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
    app.innerHTML = `<div class="empty"><h2>No episodes yet</h2><p>${esc(a.title)} hasn't released any episodes.</p>
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

  app.innerHTML = `
    <div class="crumbs"><a href="#/">Home</a> › <a href="#/anime/${a.id}">${esc(a.title)}</a> › <span id="crumb-ep"></span></div>
    <div class="watch-grid">
      <div>
        <div class="player-wrap">
          <div id="player"></div>
          <div class="pl-bar">
            <label><input type="checkbox" id="opt-autoplay" ${settings.autoplay ? 'checked' : ''}> Auto next</label>
            <span class="card-meta player-hint">Pause, seek and quality controls are inside the player.</span>
            <span class="spacer"></span>
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
              <h2 style="margin:0 0 6px"><a href="#/anime/${a.id}">${esc(a.title)}</a></h2>
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
        ${a.recommendations.length ? section('You might also like', grid(a.recommendations.slice(0, 12))) : ''}
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
          ${episodes.some((e) => e.isFiller) ? '<div class="ep-legend">Orange border = filler episode</div>' : ''}
        </div>
      </aside>
    </div>`;

  bindListSelect(a);
  const $ = (sel) => document.getElementById(sel);
  const idx = () => episodes.indexOf(current);

  const player = new Player($('player'), {
    autoskip: () => store.getSettings().autoskip,
    hasNext: () => idx() < episodes.length - 1,
    onNext: () => goTo(episodes[idx() + 1]),
    onEnded: () => {
      store.markWatched(a.id, current.number);
      watched.add(current.number);
      if (store.getSettings().autoplay && idx() < episodes.length - 1) goTo(episodes[idx() + 1]);
      else renderEpisodes();
    },
    onProgress: ({ time, duration, ep }) => {
      store.saveProgress({ animeId: a.id, ep, time, duration, title: a.title, cover: a.cover });
      if (duration && time / duration > 0.85 && !watched.has(ep)) {
        store.markWatched(a.id, ep);
        watched.add(ep);
      }
    },
  });
  onCleanup(() => player.destroy());

  $('opt-autoplay').onchange = (e) => store.setSetting('autoplay', e.target.checked);
  $('prev-ep').onclick = () => idx() > 0 && goTo(episodes[idx() - 1]);
  $('next-ep').onclick = () => idx() < episodes.length - 1 && goTo(episodes[idx() + 1]);

  let range = Math.floor(idx() / CHUNK);
  function renderEpisodes() {
    const slice = episodes.length > CHUNK ? episodes.slice(range * CHUNK, (range + 1) * CHUNK) : episodes;
    $('ep-list').innerHTML = slice.map((e) => `
      <button class="ep${e === current ? ' on' : ''}${watched.has(e.number) ? ' seen' : ''}${e.isFiller ? ' filler' : ''}"
        data-n="${e.number}" title="${esc(e.title)}${e.isFiller ? ' (filler)' : ''}">${wide ? `${e.number}. ${esc(e.title)}` : e.number}</button>`).join('');
    if ($('ep-range')) $('ep-range').value = String(range);
    $('ep-list').querySelector('.ep.on')?.scrollIntoView({ block: 'nearest' });
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
        <button class="srv${server && server.id === s.id && server.category === cat ? ' on' : ''}" data-id="${esc(s.id)}" data-cat="${cat}">${esc(s.name)}</button>`).join('')}</div>`;
    }).join('');
    $('server-list').innerHTML = groups || '<span class="card-meta">No servers available.</span>';
  }
  $('server-list').onclick = (e) => {
    const b = e.target.closest('.srv');
    if (!b) return;
    server = { id: b.dataset.id, category: b.dataset.cat };
    store.setSetting('category', server.category);
    renderServers();
    playSource(player.getCurrentTime());
  };

  async function playSource(startAt) {
    const ep = current;
    try {
      const src = await api(`/episode/${encodeURIComponent(ep.id)}/sources?server=${encodeURIComponent(server.id)}&category=${server.category}`, { fresh: true });
      if (!alive() || ep !== current) return;
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
    renderEpisodes();
    player.reset();
    $('server-list').innerHTML = '<span class="card-meta">Loading servers…</span>';
    try {
      const data = await api(`/episode/${encodeURIComponent(ep.id)}/servers`);
      if (!alive() || ep !== current) return;
      servers = data.servers;
      const pref = store.getSettings().category;
      const s = servers.find((x) => x.category === pref) || servers[0];
      server = s ? { id: s.id, category: s.category } : null;
      renderServers();
      if (!server) return player.msg('No servers for this episode yet.');
      const p = store.getProgress(a.id);
      await playSource(p && p.ep === ep.number ? p.time : 0);
    } catch (err) {
      if (alive()) player.msg(`Couldn't load servers: ${err.message}`);
    }
  }

  goTo(current);
}

// ---------- watchlist ----------
function viewWatchlist(query) {
  document.title = 'Watchlist · animee space';
  const ids = Object.keys(store.getList());
  store.ensureMeta(ids).then((changed) => { if (changed && parseHash().parts[0] === 'watchlist') route(); });
  const list = Object.values(store.getList()).filter((e) => e.title).sort((x, y) => y.updated - x.updated);
  const tab = query.get('tab') || 'all';
  const count = (k) => list.filter((e) => e.status === k).length;
  const shown = tab === 'all' ? list : list.filter((e) => e.status === tab);

  app.innerHTML = `
    <h1 class="page-title">My watchlist</h1>
    <div class="tabs">
      <a class="tab${tab === 'all' ? ' on' : ''}" href="#/watchlist">All <small>${list.length}</small></a>
      ${store.LIST_STATUSES.map(([k, l]) => `<a class="tab${tab === k ? ' on' : ''}" href="#/watchlist?tab=${k}">${l} <small>${count(k)}</small></a>`).join('')}
    </div>
    ${shown.length ? grid(shown.map((e) => ({ ...e, availableEpisodes: e.episodes }))) : `<div class="empty"><h2>Nothing here yet</h2><p>Add anime from any details page.</p><a class="btn" href="#/search">Browse anime</a></div>`}
    ${!store.currentUser() ? '<p class="card-meta" style="text-align:center;margin-top:24px"><a href="#/account" style="color:var(--accent)">Sign in</a> to sync your list and history across devices.</p>' : ''}`;
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
async function viewSchedule() {
  app.innerHTML = '<div class="empty"><h2>Schedule unavailable</h2><p>The Anikoto API currently documents recent anime and series/episode data, but no airing-schedule endpoint.</p><a class="btn" href="#/">Back home</a></div>';
}

function viewNotFound() {
  app.innerHTML = '<div class="empty"><h2>404</h2><p>This page doesn\'t exist.</p><a class="btn" href="#/">Go home</a></div>';
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
    if (q.length < 2) { box.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const d = await api('/search?q=' + encodeURIComponent(q));
        if (my !== seq) return;
        const results = Array.isArray(d.results) ? d.results : [];
        box.innerHTML = (results.length ? results.slice(0, 5).map((a) => `
          <a href="#/anime/${a.id}"><img src="${esc(a.cover)}" alt="">
            <div><div class="s-title">${esc(a.title)}</div><div class="s-meta">${[FORMAT[a.format], a.year, STATUS[a.status]].filter(Boolean).join(' · ')}</div></div></a>`).join('') : '<div class="s-empty">No matches found.</div>') +
          `<a class="s-all" href="#/search?q=${encodeURIComponent(q)}">View all results ›</a>`;
        box.hidden = false;
      } catch { if (my === seq) box.hidden = true; }
    }, 450);
  };
  box.onclick = () => { box.hidden = true; input.value = ''; };
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) box.hidden = true; });
}

// ---------- boot ----------
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
