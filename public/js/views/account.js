// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from '../site.js';
import { app, card, esc, go, route, toastNote } from '../app.js';
import { addHub } from './hub.js';

// ---------- account ----------
export function viewAccount(query) {
  viewAccountPage(query);
  addHub('account');
}
export function viewAccountPage(query) {
  document.title = `Account · ${BRAND.title}`;
  const user = store.currentUser();

  if (user) {
    const list = Object.values(store.getList());
    const history = store.continueList().length;
    const last = store.sync.lastSync ? new Date(store.sync.lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : 'not yet';
    app.innerHTML = `
      <div class="auth-box">
        <h1 class="page-title" style="margin-top:0">Hey, ${esc(user.name)} 👋</h1>
        <p class="card-meta">Your watchlist, watch history and player settings sync to this account. The same account signs you in on animee, cinemee and mangee; each site keeps its own list.</p>
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
          <p class="card-meta">This deletes your account on all our sites (animee, cinemee and mangee) and the lists, progress and settings saved with it on our server. It can't be undone. What's saved in this browser stays until you clear it.</p>
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
        <p class="card-meta">${mode === 'login' ? 'No account yet? <a href="/account?mode=register" style="color:var(--accent)">Create one</a>' : 'No email needed, and one account works on animee, cinemee and mangee. Anything you already watched in this browser gets added to your account.'}</p>
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
