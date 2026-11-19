// Library (watchlist + progress + watched episodes) and settings.
// Always saved in this browser; when signed in, changes also sync to your account.
//
// One entry per anime: { a, s, ep, t, d, w, u, m }
//   s  list status (0 none, 1 watching, 2 planning, 3 completed, 4 on hold, 5 dropped)
//   ep last episode opened, t/d seconds watched / episode length
//   w  watched episode numbers (array here, compact bitset on the server)
//   u  last change (unix seconds)
//   m  cached title/cover for display — local only, never uploaded

import { api } from './api.js';

const PREFIX = 'animee-space:';
const read = (key, fallback) => {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* full or blocked */ }
};
const now = () => Math.floor(Date.now() / 1000);

export const LIST_STATUSES = [
  ['watching', 'Watching'],
  ['planning', 'Plan to watch'],
  ['completed', 'Completed'],
  ['paused', 'On hold'],
  ['dropped', 'Dropped'],
];
const CODE = { watching: 1, planning: 2, completed: 3, paused: 4, dropped: 5 };
const NAME = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));

let lib = read('lib', {});
let dirty = new Set(read('dirty', []));
const saveLib = () => { write('lib', lib); write('dirty', [...dirty]); };

const metaOf = (a) => ({ title: a.title, cover: a.cover, format: a.format, episodes: a.episodes ?? null, year: a.year ?? null, score: a.score ?? null });
function entry(id) {
  return lib[id] || (lib[id] = { a: Number(id), s: 0, ep: 0, t: 0, d: 0, w: [], u: 0, m: null });
}
function touch(e) {
  e.u = now();
  if (!e.s && !e.ep && !e.w.length) delete lib[e.a];
  dirty.add(e.a);
  saveLib();
  sync.schedule();
}

// ---------- watchlist ----------
export function getList() {
  const out = {};
  for (const e of Object.values(lib)) {
    if (e.s) out[e.a] = { id: e.a, ...(e.m || {}), status: NAME[e.s], updated: e.u };
  }
  return out;
}
export const getEntry = (id) => (lib[id]?.s ? { status: NAME[lib[id].s] } : null);
export function setEntry(anime, status) {
  const e = entry(anime.id);
  e.s = CODE[status] || 0;
  e.m = metaOf(anime);
  touch(e);
}

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

// ---------- missing titles/posters (e.g. history synced from another device) ----------
const metaTried = new Set(); // ask AniList once per id per page load, even if it has no result
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
export const libraryIds = () => Object.keys(lib).map(Number);

// ---------- settings ----------
let settings = { autoplay: true, autoskip: false, category: 'sub', ...read('settings', {}) };
export const getSettings = () => ({ ...settings });
export function setSetting(key, value) {
  settings = { ...settings, [key]: value };
  write('settings', settings);
  write('settingsDirty', true);
  sync.schedule();
}
const prefsBits = () => (settings.autoplay ? 1 : 0) | (settings.autoskip ? 2 : 0) | (settings.category === 'dub' ? 4 : 0);
function applyPrefs(bits) {
  settings = { ...settings, autoplay: !!(bits & 1), autoskip: !!(bits & 2), category: bits & 4 ? 'dub' : 'sub' };
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
function adopt(row) {
  const local = lib[row.a];
  const w = [...new Set([...(local?.w || []), ...fromBits(row.w)])];
  if (local && local.u > row.u) { local.w = w; return; }
  if (row.deleted) { delete lib[row.a]; return; }
  lib[row.a] = { a: row.a, s: row.s, ep: row.ep, t: row.t, d: row.d, w, u: row.u, m: local?.m || null };
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
      const sentU = new Map(rows.map((r) => [r.a, lib[r.a]?.u]));
      const res = await post('/me/sync', { rows, ...(sendPrefs ? { prefs: prefsBits() } : {}) }, { keepalive });
      // only clear what didn't change again while the request was in flight
      ids.forEach((id) => { if (lib[id]?.u === sentU.get(id)) dirty.delete(id); });
      res.rows.forEach(adopt);
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

  // full download + merge, used on sign-in and page load
  async pull() {
    const res = await fetch('/api/me/library', { credentials: 'same-origin' });
    if (res.status === 401) return this.signedOut();
    if (!res.ok) return;
    const data = await res.json();
    const server = new Map(data.rows.map((r) => [r.a, r]));
    for (const row of data.rows) {
      const local = lib[row.a];
      if (local) {
        const serverWatched = new Set(fromBits(row.w));
        if (local.u > row.u || local.w.some((n) => !serverWatched.has(n))) dirty.add(row.a);
      }
      adopt(row);
    }
    // anything only this browser has gets uploaded
    for (const id of Object.keys(lib)) if (!server.has(Number(id))) dirty.add(Number(id));
    if (!read('settingsDirty', false)) applyPrefs(data.prefs);
    saveLib();
    this.lastSync = Date.now();
    emit({ user: this.user, synced: true });
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

// upload before the tab closes or goes to the background
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && sync.user && dirty.size) {
    clearTimeout(sync.timer);
    sync.timer = null;
    sync.push({ keepalive: true });
  }
});
