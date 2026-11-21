// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from '../site.js';
import { FORMAT, app, card, esc, grid, onCleanup, parseHash, route, section, selectField, toastNote, undoToast } from '../app.js';
import { addHub } from './hub.js';

// ---------- a shared list (/u/<name>) ----------
export async function viewShared(name, alive, query) {
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
export function ratingStats() {
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
export function viewStats() {
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
export const LIST_PAGE = 60;
export const asCard = (e) => ({ ...e, availableEpisodes: e.episodes });
export const LIST_SORTS = [['recent', 'Last changed first'], ['oldest', 'First changed first'], ['title', 'Title A-Z'], ['year', 'Newest year'], ['rating', 'My rating']];
export function viewWatchlist(query) {
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
