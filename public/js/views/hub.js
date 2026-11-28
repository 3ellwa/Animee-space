// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, IS_MANGEE, SIBLING } from '../site.js';
import { app, card, checkNewEpisodes, contCard, esc, grid, loader, parseHash, section } from '../app.js';

// ---------- new for you ----------
export async function viewNew(alive) {
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
export const NEWS = IS_MANGEE ? [
  ['Nov 25', ['Welcome to mangee: manga from MangaDex, with the same lists, sync and pop-ups', 'Read by scrolling or one page at a time', 'Your exact page is saved', 'Arabic chapters in Settings', 'One account for animee, cinemee and mangee']],
] : IS_CINEMEE ? [
  ['Nov 28', ['New ad-free server: Altair, with Arabic subtitles', 'Smart TVs: the picture stays inside the player box on older TVs']],
  ['Nov 24', ['Rate anything 1-10, and see your ratings in Stats', 'Share your list with a link (Account)', 'Popular on cinemee this week', 'Chat in watch parties', 'Use your own .srt subtitles (CC button, Atlas server)', 'Ad-free servers first: 3ellwa and JoJo', 'Two new servers with Arabic subtitles: Sirius and Rigel', 'Works on smart TVs with the remote (Settings → TV mode)']],
  ['Nov 23', ['Watch party: friends follow your episode and position, with reactions', 'Search finds titles even with typos, and remembers your recent searches', 'Weekly summary pop-ups (Settings)', 'Switch to where you are on your other device', 'My list, History and Stats open offline']],
  ['Nov 22', ['Seasons on TV pages, and season by season in the episode list', 'Hover a poster for its trailer', 'Share a moment: a link that opens at the exact minute', 'Continue on animee, right here', 'Real air times for TV', 'IMDb and Rotten Tomatoes scores', 'Search and remove items in History']],
  ['Nov 21', ['Welcome to cinemee: movies and TV, with the same lists, sync and pop-ups as animee', 'Up next stays in fullscreen', 'Save any title from its poster', 'Hide genres you skip']],
] : [
  ['Nov 28', ['3ellwa and JoJo swapped places: 3ellwa now plays sub and dub', 'Smart TVs: the picture stays inside the player box on older TVs']],
  ['Nov 24', ['Rate anything 1-10, and see your ratings in Stats', 'Share your list with a link (Account)', 'Popular on animee this week', 'Chat in watch parties', '3ellwa remembers speed and volume per show', 'Ad-free servers first: 3ellwa and JoJo (the old Kaze and Ram)', 'Works on smart TVs with the remote (Settings → TV mode)']],
  ['Nov 23', ['Watch party: friends follow your episode and position, with reactions', 'Search handles typos better and remembers your recent searches', 'Weekly summary pop-ups (Settings)', 'Switch to where you are on your other device', 'My list, History and Stats open offline']],
  ['Nov 22', ['Hover a poster for its trailer', 'Share a moment: a link that opens at the exact minute', 'Continue on cinemee, right here', 'Servers that keep failing on an episode are tried last', 'Search and remove items in History, with Undo']],
  ['Nov 21', ['Resume where you stopped on 3ellwa, with Start over', 'Auto skip intros and outros', 'Up next stays in fullscreen', 'Save any show from its poster', 'Select mode on My list', 'Hide genres you skip', '← → jump 10 seconds', 'Follow shows from the schedule', 'Picked for you on the home page']],
  ['Earlier', ['New-episode pop-ups', 'My Anime hub with Requests', 'Continue on any device', 'Short server names']],
];
export const NEWS_VERSION = `${BRAND.name}-${NEWS[0][0]}`;
export function showNews() {
  let seen = '';
  try { seen = localStorage.getItem('animee-space:news') || ''; } catch { /* ignore */ }
  if (seen === NEWS_VERSION || document.getElementById('news-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'news-bar';
  bar.className = 'news-bar';
  bar.innerHTML = `<span><b>New</b><span class="news-long"> on ${BRAND.name}, updated</span> ${esc(NEWS[0][0])}</span>
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
export const HUB_TABS = [
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
export const HOW_KEY = 'animee-space:how-hidden';
export function hubHead(active) {
  // The tips start closed once you have something on your list; your own choice wins either way.
  let hidden = Object.keys(store.getList()).length > 0;
  try { const saved = localStorage.getItem(HOW_KEY); if (saved !== null) hidden = saved === '1'; } catch { /* ignore */ }
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
export function addHub(active) {
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
export function viewMe() {
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
export function requesterId() {
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
export const KIND_LABEL = { anime: IS_CINEMEE ? 'A movie or show you want added' : 'An anime you want added', idea: 'An idea for the site', broken: 'Something is broken', other: 'Something else' };
export const fmtWhen = (sec) => new Date(sec * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export async function viewRequests(alive) {
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
