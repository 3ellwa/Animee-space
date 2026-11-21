// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from '../site.js';
import { FORMAT, T, animeHref, app, card, cardShows, esc, fmtCountdown, grid, loader, localTime, nextBroadcast, score, section, unstarted } from '../app.js';

// ---------- schedule ----------
export const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export function schedRow(a, note) {
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
export async function viewSchedule(query, alive) {
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
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export async function viewAZ(query, alive) {
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
export const MOODS = IS_CINEMEE ? [
  ['laugh', 'Make me laugh', ['Comedy']], ['romance', 'Something romantic', ['Romance']], ['fights', 'Big action', ['Action']],
  ['cozy', 'Something for the family', ['Family']], ['guessing', 'Keep me guessing', ['Mystery']], ['scare', 'Scare me', ['Horror']],
  ['future', 'Into the future', ['Science Fiction']], ['cry', 'Make me cry', ['Drama']], ['real', 'True stories', ['Documentary']],
] : [
  ['laugh', 'Make me laugh', ['Comedy']], ['romance', 'Something romantic', ['Romance']], ['fights', 'Big fights', ['Action']],
  ['cozy', 'Calm and cozy', ['Iyashikei']], ['guessing', 'Keep me guessing', ['Mystery']], ['scare', 'Scare me', ['Horror']],
  ['isekai', 'Another world', ['Isekai']], ['cry', 'Make me cry', ['Drama']], ['sports', 'Sports and teamwork', ['Sports']],
];
export const LENGTHS = IS_CINEMEE ? [['movie', 'A movie', 'MOVIE'], ['series', 'A series', 'TV']]
  : [['short', 'Short, up to 13 episodes', 1, 13], ['mid', 'One or two seasons, 14 to 26', 14, 26], ['long', 'Long, more than 26', 27, 99999]];
export const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

export async function viewPick(alive) {
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
