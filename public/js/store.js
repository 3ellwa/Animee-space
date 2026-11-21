// Library (watchlist + progress + watched episodes) and settings.
// Always saved in this browser; when signed in, changes also sync to your account.
//
// One entry per anime: { a, s, ep, t, d, w, u, m }
//   s  list status in the low 3 bits (0 none, 1 watching, 2 planning, 3 completed, 4 on hold,
//      5 dropped, 6 not interested), plus 8 when the show is a favourite
//   ep last episode opened, t/d seconds watched / episode length
//   w  watched episode numbers (array here, compact bitset on the server)
//   u  last change (unix seconds)
//   m  cached title/cover for display — local only, never uploaded

import { api } from './api.js';
import { BRAND } from './site.js';

const PREFIX = 'animee-space:';
const read = (key, fallback) => {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* full or blocked */ }
};
// Change times are compared across devices, so they use the server's clock: each sync response
// carries the server time and this browser keeps its offset from it.
let clockOffset = read('clockOffset', 0);
const learnClock = (serverNow) => {
  if (!Number.isFinite(serverNow)) return;
  clockOffset = Math.round(serverNow - Date.now() / 1000);
  write('clockOffset', clockOffset);
};
const now = () => Math.floor(Date.now() / 1000) + clockOffset;

export const LIST_STATUSES = [
  ['watching', 'Watching'],
  ['planning', 'Plan to watch'],
  ['completed', 'Completed'],
  ['paused', 'On hold'],
  ['dropped', 'Dropped'],
  ['notinterested', 'Not interested'],
];
const CODE = { watching: 1, planning: 2, completed: 3, paused: 4, dropped: 5, notinterested: 6 };
const NAME = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
const FAVOURITE = 8;
// Bits 16 and 32 remember this show's audio: 16 = a choice was made, 32 = dub (else sub).
const LANG_SET = 16, LANG_DUB = 32;
// Bit 64: following the show (🔔): new episodes go to Notifications and, if allowed, pop-ups.
const FOLLOW = 64;
const KEEP = FAVOURITE | LANG_SET | LANG_DUB | FOLLOW; // bits a list-status change leaves alone
const ON_LIST = 7 | FAVOURITE;
const statusOf = (e) => NAME[e.s & 7] || null;
const isFav = (e) => !!(e.s & FAVOURITE);

let lib = read('lib', {});
let dirty = new Set(read('dirty', []));
const saveLib = () => { write('lib', lib); write('dirty', [...dirty]); };

// air: the show's airing status (RELEASING, FINISHED…), used by the new-episode inbox.
// air / genres / duration are only included when known, so merging a partial record
// (an import, a backup) never wipes them.
function metaOf(a) {
  const m = { title: a.title, cover: a.cover, format: a.format, episodes: a.episodes ?? null, year: a.year ?? null, score: a.score ?? null };
  const air = a.air || (/^[A-Z_]+$/.test(a.status || '') ? a.status : null);
  if (air) m.air = air;
  if (Array.isArray(a.genres) && a.genres.length) m.genres = a.genres.slice(0, 8);
  if (a.duration) m.duration = a.duration;
  return m;
}
// Refresh the cached title/cover/airing details of a show already in the library.
export function rememberMeta(a) {
  const e = lib[a?.id];
  if (!e) return;
  e.m = { ...(e.m || {}), ...metaOf(a) };
  write('lib', lib);
}
function entry(id) {
  return lib[id] || (lib[id] = { a: String(id), s: 0, ep: 0, t: 0, d: 0, w: [], u: 0, m: null });
}
function touch(e) {
  e.u = now();
  if (!e.s && !e.ep && !e.w.length) delete lib[e.a];
  dirty.add(e.a);
  saveLib();
  sync.schedule();
}

// ---------- watchlist ----------
// Every show with a list status or a favourite. status is null for a favourite with no status.
export function getList() {
  const out = {};
  for (const e of Object.values(lib)) {
    if (e.s & ON_LIST) out[e.a] = { id: e.a, ...(e.m || {}), status: statusOf(e), favourite: isFav(e), updated: e.u };
  }
  return out;
}
export const getEntry = (id) => {
  const e = lib[id];
  return e && (e.s & ON_LIST) ? { status: statusOf(e), favourite: isFav(e) } : null;
};
export function setEntry(anime, status) {
  const e = entry(anime.id);
  e.s = (CODE[status] || 0) | (e.s & KEEP);
  e.m = { ...(e.m || {}), ...metaOf(anime) };
  touch(e);
}
// ---------- following ----------
export const isFollowing = (id) => !!((lib[id]?.s || 0) & FOLLOW);
export const followedIds = () => Object.values(lib).filter((e) => e.s & FOLLOW).map((e) => e.a);
const followListeners = new Set();
export const onFollowChange = (fn) => { followListeners.add(fn); return () => followListeners.delete(fn); };
// baseline: episodes already out when you followed, so only later ones count as new.
export function setFollow(anime, on, baseline = 0) {
  const e = entry(anime.id);
  e.s = (e.s & ~FOLLOW) | (on ? FOLLOW : 0);
  e.m = { ...(e.m || {}), ...metaOf(anime) };
  // fbk: the baseline is known, even when it is 0 (an upcoming show: episode 1 will be new).
  // Known when there's a real count, or when the show hasn't started (then 0 is right). Otherwise
  // the inbox looks the count up first, so a long-running show never shows "Episode 1 is out".
  if (on) { e.fb = Math.max(e.fb || 0, Number(baseline) || 0); e.fbk = e.fbk || Number(baseline) > 0 || anime.status === 'NOT_YET_RELEASED'; }
  touch(e);
  followListeners.forEach((fn) => { try { fn(followedIds()); } catch { /* ignore */ } });
}
export const followBaseline = (id) => lib[id]?.fb || 0;
export const followBaselineKnown = (id) => Boolean(lib[id]?.fbk);
export function setFollowBaseline(id, ep) {
  const e = lib[id];
  if (!e || ((e.fb || 0) >= ep && e.fbk)) return;
  e.fb = Math.max(e.fb || 0, ep);
  e.fbk = true;
  write('lib', lib);
}

// Sub or dub for one show (null when never chosen; the global setting applies then).
export const showCategory = (id) => {
  const s = lib[id]?.s || 0;
  return s & LANG_SET ? (s & LANG_DUB ? 'dub' : 'sub') : null;
};
export function setShowCategory(id, category) {
  if (showCategory(id) === category) return;
  const e = entry(id);
  e.s = (e.s & ~(LANG_SET | LANG_DUB)) | LANG_SET | (category === 'dub' ? LANG_DUB : 0);
  touch(e);
}
export function setFavourite(anime, on) {
  const e = entry(anime.id);
  e.s = (e.s & ~FAVOURITE) | (on ? FAVOURITE : 0);
  e.m = { ...(e.m || {}), ...metaOf(anime) };
  touch(e);
}
// Shows marked "Not interested", hidden from home rows, picks and recommendations.
export const notInterestedIds = () => new Set(Object.values(lib).filter((e) => (e.s & 7) === CODE.notinterested).map((e) => e.a));

// ---------- progress ----------
export function getProgress(id) {
  const e = lib[id];
  return e?.ep ? { animeId: e.a, ep: e.ep, time: e.t, duration: e.d, title: e.m?.title, cover: e.m?.cover } : null;
}
export function saveProgress({ animeId, ep, time, duration, title, cover }) {
  const e = entry(animeId);
  e.ep = ep;
  e.t = Math.round(time || 0);
  e.d = Math.round(duration || 0);
  if (title) e.m = { ...(e.m || {}), title, cover };
  touch(e);
}
export function removeProgress(id) {
  const e = lib[id];
  if (!e) return;
  e.ep = 0; e.t = 0; e.d = 0;
  touch(e);
}
export const continueList = () => Object.values(lib)
  .filter((e) => e.ep)
  .sort((x, y) => y.u - x.u)
  .slice(0, 12)
  .map((e) => ({ animeId: e.a, ep: e.ep, time: e.t, duration: e.d, title: e.m?.title, cover: e.m?.cover, updated: e.u }));

// ---------- watched ----------
export const watchedSet = (id) => new Set(lib[id]?.w || []);
export function markWatched(id, number) {
  const e = entry(id);
  if (e.w.includes(number)) return;
  e.w.push(number);
  touch(e);
}

// ---------- servers that actually played (this browser only) ----------
// Each show + language remembers the last server whose video started, so after a failure and
// an automatic switch, the next episode starts on the server that works instead of failing again.
const GOOD_MAX = 300;
let good = read('goodServers', {});
export const goodServer = (id, category) => good[`${id}:${category}`] || null;
export function setGoodServer(id, category, provider) {
  const key = `${id}:${category}`;
  if (good[key] === provider) return;
  delete good[key];
  good[key] = provider; // newest last, so trimming drops the oldest
  const keys = Object.keys(good);
  if (keys.length > GOOD_MAX) keys.slice(0, keys.length - GOOD_MAX).forEach((k) => delete good[k]);
  write('goodServers', good);
}

// ---------- watch history (this browser only, newest first) ----------
const HISTORY_MAX = 300;
let history = read('history', []);
export const getHistory = () => history.slice();
export function addHistory({ animeId, ep, title, cover }) {
  const id = String(animeId);
  // Opening the same episode again just moves it to the top.
  history = [{ animeId: id, ep, title, cover, at: Date.now() }, ...history.filter((h) => !(h.animeId === id && h.ep === ep))]
    .slice(0, HISTORY_MAX);
  write('history', history);
}
export function clearHistory() { history = []; write('history', history); }
/** Forget every saved position and watched tick (list statuses and favourites stay). */
export function clearProgress() {
  for (const e of Object.values(lib)) {
    if (!e.ep && !e.w.length) continue;
    e.ep = 0; e.t = 0; e.d = 0; e.w = [];
    touch(e);
  }
}
/** Signed-in: delete the account on the server, then sign out here. */
export async function deleteAccount(password) {
  await post('/auth/delete', { password });
  sync.signedOut();
}

// ---------- import (MyAnimeList / AniList / backup) ----------
// items: [{ id, status, title?, cover?, format?, episodes?, year?, watchedUpTo? }]
// mode 'add' keeps shows already on the list; 'replace' clears list statuses first (progress is kept).
export function importEntries(items, mode = 'add') {
  // Replacing clears list statuses but keeps favourites.
  if (mode === 'replace') for (const e of Object.values(lib)) if (e.s & 7) { e.s &= KEEP; touch(e); }
  let added = 0;
  for (const item of items) {
    const id = String(item.id || '');
    if (!/^\d{1,12}$/.test(id) || !CODE[item.status]) continue;
    const e = entry(id);
    if (mode === 'add' && (e.s & 7)) continue;
    e.s = CODE[item.status] | (e.s & KEEP);
    if (item.title) e.m = { ...(e.m || {}), ...metaOf({ title: item.title, cover: item.cover || e.m?.cover || null, format: item.format || null, episodes: item.episodes ?? null, year: item.year ?? null }) };
    const upTo = Math.min(Number(item.watchedUpTo) || 0, 3000);
    if (upTo > 0) e.w = [...new Set([...e.w, ...Array.from({ length: upTo }, (_, i) => i + 1)])];
    e.u = now();
    dirty.add(e.a);
    added++;
  }
  saveLib();
  sync.schedule(2000);
  return added;
}

// ---------- backup file ----------
export function exportBackup() {
  return { app: BRAND.backup, version: 1, exported: new Date().toISOString(), library: Object.values(lib), history };
}
export function restoreBackup(data, mode = 'add') {
  if (!data || data.app !== BRAND.backup || !Array.isArray(data.library)) throw new Error(`This is not a ${BRAND.title} backup file.`);
  // Clear rather than delete, so a signed-in account also drops the old entries on the next sync.
  if (mode === 'replace') for (const e of Object.values(lib)) { e.s = 0; e.ep = 0; e.t = 0; e.d = 0; e.u = now(); dirty.add(e.a); }
  let restored = 0;
  for (const raw of data.library) {
    const id = String(raw?.a || '');
    if (!/^\d{1,12}$/.test(id)) continue;
    const current = lib[id];
    // In "add" mode, a show already on the list (or with progress) keeps its newer local copy.
    if (current && mode === 'add' && (current.s || current.ep) && current.u >= (raw.u || 0)) continue;
    lib[id] = {
      a: id, s: ((Number(raw.s) & 7) <= 6 ? Number(raw.s) & 127 : Number(raw.s) & KEEP) || 0, ep: Number(raw.ep) || 0, t: Number(raw.t) || 0, d: Number(raw.d) || 0,
      w: Array.isArray(raw.w) ? raw.w.filter((n) => Number.isInteger(n) && n > 0 && n <= 8000) : [],
      u: now(), m: raw.m && typeof raw.m === 'object' ? metaOf(raw.m) : null,
    };
    dirty.add(id);
    restored++;
  }
  if (Array.isArray(data.history)) {
    history = [...data.history.filter((h) => h && /^\d{1,12}$/.test(String(h.animeId))), ...(mode === 'replace' ? [] : history)]
      .sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, HISTORY_MAX);
    write('history', history);
  }
  saveLib();
  sync.schedule(2000);
  return restored;
}

// ---------- missing titles/posters (e.g. history synced from another device) ----------
const metaTried = new Set(); // ask Anikoto once per id per page load, even if it has no result
export async function ensureMeta(ids) {
  const missing = ids.filter((id) => lib[id] && !lib[id].m?.title && !metaTried.has(id)).slice(0, 10);
  if (!missing.length) return false;
  missing.forEach((id) => metaTried.add(id));
  try {
    const { results } = await api('/batch?ids=' + missing.join(','));
    let filled = false;
    for (const a of results) if (lib[a.id]) { lib[a.id].m = metaOf(a); filled = true; }
    if (filled) write('lib', lib);
    return filled;
  } catch { return false; }
}
export const libraryIds = () => Object.keys(lib);
// One summary row per show, for the stats page.
export const libraryRows = () => Object.values(lib).map((e) => ({
  id: e.a, title: e.m?.title || null, cover: e.m?.cover || null, status: statusOf(e), favourite: isFav(e),
  watched: e.w.length, genres: e.m?.genres || null, duration: e.m?.duration || null, format: e.m?.format || null, air: e.m?.air || null,
}));
// Shows with any progress or watched episodes.
export const startedIds = () => new Set(Object.values(lib).filter((e) => e.ep || e.w.length).map((e) => e.a));

// ---------- settings ----------
// titles: 'english' or 'japanese' (romaji). showContinue / hideStarted control the home page.
// Only autoplay, autoskip and category sync to an account; the rest stay in this browser.
// alertsFor: which new episodes count for Notifications and pop-ups: 'both', 'sub' or 'dub'.
let settings = { autoplay: true, autoskip: false, category: 'sub', provider: 'megaplay', titles: 'english', showContinue: true, hideStarted: false, alertsFor: 'both', ...read('settings', {}) };
export const getSettings = () => ({ ...settings });
export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  write('settings', settings);
  write('settingsDirty', true);
  sync.schedule();
}
// bits: 1 autoplay, 2 autoskip, 4 dub, 8 AnimeParadise as the preferred server (else MegaPlay)
const prefsBits = () => (settings.autoplay ? 1 : 0) | (settings.autoskip ? 2 : 0) | (settings.category === 'dub' ? 4 : 0)
  | (settings.provider === 'animeparadise' ? 8 : 0);
function applyPrefs(bits) {
  settings = { ...settings, autoplay: !!(bits & 1), autoskip: !!(bits & 2), category: bits & 4 ? 'dub' : 'sub', provider: bits & 8 ? 'animeparadise' : 'megaplay' };
  write('settings', settings);
}

// ---------- bitsets ----------
function toBits(nums) {
  if (!nums?.length) return null;
  const bytes = new Uint8Array(Math.ceil(Math.max(...nums) / 8));
  for (const n of nums) if (n > 0) bytes[(n - 1) >> 3] |= 1 << ((n - 1) & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromBits(b64) {
  if (!b64) return [];
  const out = [];
  const bin = atob(b64);
  for (let i = 0; i < bin.length; i++) {
    const byte = bin.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) out.push(i * 8 + bit + 1);
  }
  return out;
}
const toRow = (e) => ({ a: e.a, s: e.s, ep: e.ep, t: e.t, d: e.d, w: toBits(e.w), u: e.u });

// ---------- sync ----------
const listeners = new Set();
export const onSyncChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (state) => listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });

// Take a row from the server, unless this browser has a newer change. Watched episodes are always combined.
// Returns true when this browser's copy changed.
function adopt(row) {
  const local = lib[row.a];
  const before = local ? `${local.s},${local.ep},${local.t},${local.w.length}` : '';
  adoptRow(row, local);
  const e = lib[row.a];
  return (e ? `${e.s},${e.ep},${e.t},${e.w.length}` : '') !== before;
}
function adoptRow(row, local) {
  const w = [...new Set([...(local?.w || []), ...fromBits(row.w)])];
  if (local && local.u > row.u) { local.w = w; return; }
  if (row.deleted) { delete lib[row.a]; return; }
  lib[row.a] = { a: row.a, s: row.s, ep: row.ep, t: row.t, d: row.d, w, u: row.u, m: local?.m || null, ...(local?.fb ? { fb: local.fb } : {}), ...(local?.fbk ? { fbk: true } : {}) };
}

async function post(path, body, { keepalive = false } = {}) {
  const r = await fetch('/api' + path, {
    method: 'POST', credentials: 'same-origin', keepalive,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

export const sync = {
  user: null,
  timer: null,
  busy: false,
  lastSync: null,

  schedule(delay = 20000) {
    if (!this.user || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.push(); }, delay);
  },

  async push({ keepalive = false } = {}) {
    if (!this.user || this.busy) return;
    const ids = [...dirty].slice(0, 200);
    const sendPrefs = read('settingsDirty', false);
    if (!ids.length && !sendPrefs) return;
    this.busy = true;
    try {
      const rows = ids.map((id) => (lib[id] ? toRow(lib[id]) : { a: id, s: 0, ep: 0, t: 0, d: 0, w: null, u: now() }));
      // What was sent, so a change made while the request is in flight (even within the same
      // second) is neither overwritten by the reply nor dropped from the next upload.
      const stateOf = (id) => (lib[id] ? JSON.stringify(toRow(lib[id])) : 'gone');
      const sent = new Map(rows.map((r) => [r.a, stateOf(r.a)]));
      const res = await post('/me/sync', { rows, ...(sendPrefs ? { prefs: prefsBits() } : {}) }, { keepalive });
      // only clear what didn't change again while the request was in flight
      const changed = new Set(ids.filter((id) => stateOf(id) !== sent.get(id)));
      ids.forEach((id) => { if (!changed.has(id)) dirty.delete(id); });
      learnClock(res.now);
      res.rows.forEach((row) => { if (!changed.has(String(row.a))) adopt(row); });
      if (sendPrefs) write('settingsDirty', false);
      saveLib();
      this.lastSync = Date.now();
      emit({ user: this.user, synced: true });
      if (dirty.size) this.schedule(2000);
    } catch (err) {
      if (err.status === 401) this.signedOut();
      else this.schedule(60000); // offline or server busy: try again later
    } finally {
      this.busy = false;
    }
  },

  // Push now instead of waiting for the timer (pause, episode end, leaving the player).
  flush() {
    if (!this.user || !dirty.size) return;
    clearTimeout(this.timer);
    this.timer = null;
    return this.push();
  },

  // Pull unless one finished in the last maxAge ms; concurrent callers share one request.
  // Never waits longer than `timeout` ms, so a slow network can't hold up the page.
  pulling: null,
  freshen({ maxAge = 10000, timeout = 2500 } = {}) {
    if (!this.user) return Promise.resolve(false);
    if (!this.pulling && this.lastSync && Date.now() - this.lastSync < maxAge) return Promise.resolve(false);
    if (!this.pulling) this.pulling = this.pull().catch(() => {}).finally(() => { this.pulling = null; });
    return Promise.race([this.pulling.then(() => true), new Promise((r) => setTimeout(() => r(false), timeout))]);
  },

  // full download + merge, used on sign-in, page load and when the tab comes back
  async pull() {
    const res = await fetch('/api/me/library', { credentials: 'same-origin' });
    if (res.status === 401) return this.signedOut();
    if (!res.ok) return;
    const data = await res.json();
    learnClock(data.now);
    const server = new Map(data.rows.map((r) => [String(r.a), r]));
    const changed = new Set();
    for (const row of data.rows) {
      const local = lib[row.a];
      if (local) {
        const serverWatched = new Set(fromBits(row.w));
        if (local.u > row.u || local.w.some((n) => !serverWatched.has(n))) dirty.add(row.a);
      }
      if (adopt(row)) changed.add(String(row.a));
    }
    // anything only this browser has gets uploaded
    for (const id of Object.keys(lib)) if (!server.has(String(id))) dirty.add(String(id));
    if (!read('settingsDirty', false)) applyPrefs(data.prefs);
    saveLib();
    this.lastSync = Date.now();
    emit({ user: this.user, synced: true, pulled: true, changed });
    await this.push();
  },

  signedOut() {
    this.user = null;
    clearTimeout(this.timer);
    this.timer = null;
    emit({ user: null });
  },
};

// ---------- account ----------
export async function initAccount() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const d = await r.json();
    sync.user = d.user || null;
  } catch { sync.user = null; }
  emit({ user: sync.user });
  if (sync.user) await sync.pull().catch(() => {});
  return sync.user;
}
export async function register(username, password) {
  const d = await post('/auth/register', { username, password });
  sync.user = d.user;
  await sync.pull();
  return d.user;
}
export async function login(username, password) {
  const d = await post('/auth/login', { username, password });
  sync.user = d.user;
  await sync.pull();
  return d.user;
}
export async function logout({ everywhere = false, clearLocal = false } = {}) {
  await sync.push().catch(() => {});
  await post(everywhere ? '/auth/logout-all' : '/auth/logout').catch(() => {});
  if (clearLocal) { lib = {}; dirty = new Set(); saveLib(); }
  sync.signedOut();
}
export const currentUser = () => sync.user;

// Upload before the tab closes or goes to the background; download when it comes back,
// so switching from the laptop to the phone picks up where you stopped.
document.addEventListener('visibilitychange', () => {
  if (!sync.user) return;
  if (document.visibilityState === 'hidden') {
    if (!dirty.size) return;
    clearTimeout(sync.timer);
    sync.timer = null;
    sync.push({ keepalive: true });
  } else {
    sync.freshen();
  }
});
window.addEventListener('pagehide', () => { if (sync.user && dirty.size) sync.push({ keepalive: true }); });
