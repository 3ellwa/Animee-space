// "New for you": airing shows on your Watching list whose next episode is out.
// Worked out in the browser from your list and watched episodes; the server is only asked
// whether an episode plays (an edge-cached check), so nothing new is stored on Cloudflare.

import { api } from './api.js';
import * as store from './store.js';

const KEY = 'animee-space:inbox';
const DISMISSED = 'animee-space:inbox-dismissed';
const STALE_MS = 30 * 60 * 1000;
const MAX_SHOWS = 24;

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } };

const listeners = new Set();
export const onInboxChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Items still worth showing: not dismissed, and not watched since the last check.
export function inboxItems() {
  const dismissed = new Set(read(DISMISSED, []));
  return (read(KEY, {}).items || []).filter((it) => !dismissed.has(`${it.id}:${it.ep}`) && !store.watchedSet(it.id).has(it.ep));
}
export const inboxCheckedAt = () => read(KEY, {}).checked || 0;

export function dismiss(item) {
  const list = read(DISMISSED, []).filter((k) => !k.startsWith(`${item.id}:`));
  write(DISMISSED, [...list, `${item.id}:${item.ep}`].slice(-300));
  listeners.forEach((fn) => fn(inboxItems()));
}

// Runs a few requests at a time so a long list doesn't flood the server.
async function eachLimited(items, limit, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

let running = null;
export function refreshInbox({ force = false } = {}) {
  if (!force && Date.now() - inboxCheckedAt() < STALE_MS) return Promise.resolve(inboxItems());
  if (running) return running;
  running = (async () => {
    const watching = Object.values(store.getList()).filter((e) => e.status === 'watching').slice(0, MAX_SHOWS);
    // Airing status isn't always known locally (older entries, other devices): ask in batches of 6.
    const unknown = watching.filter((e) => !e.air).map((e) => e.id);
    for (let i = 0; i < unknown.length; i += 6) {
      try {
        const { results } = await api('/batch?ids=' + unknown.slice(i, i + 6).join(','));
        results.forEach((a) => store.rememberMeta(a));
      } catch { /* try again next time */ }
    }
    const list = store.getList();
    const airing = watching.map((e) => list[e.id]).filter((e) => e?.air === 'RELEASING');
    const items = [];
    const preferred = store.getSettings().category;
    await eachLimited(airing, 4, async (e) => {
      const watched = [...store.watchedSet(e.id)];
      if (!watched.length) return; // not started yet, so nothing is "new"
      const next = Math.max(...watched) + 1;
      if (e.episodes && next > e.episodes) return;
      try {
        const d = await api(`/anime/${e.id}/available?ep=${next}`);
        const cat = store.showCategory(e.id) || preferred;
        if (d[cat] || d.sub || d.dub) items.push({ id: e.id, ep: next, title: e.title, cover: e.cover, cat: d[cat] ? cat : d.sub ? 'sub' : 'dub' });
      } catch { /* skip this one */ }
    });
    write(KEY, { checked: Date.now(), items });
    const visible = inboxItems();
    listeners.forEach((fn) => fn(visible));
    return visible;
  })().finally(() => { running = null; });
  return running;
}
