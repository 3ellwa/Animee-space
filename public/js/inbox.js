// Notifications: new episodes of airing shows you follow (🔔) or have on your Watching list.
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
    const followed = new Set(store.followedIds());
    const libraryRows = store.libraryRows();
    const byId = Object.fromEntries(libraryRows.map((r) => [r.id, r]));
    // Followed shows first, then the rest of Watching.
    const ids = [...new Set([...followed, ...libraryRows.filter((r) => r.status === 'watching').map((r) => r.id)])].slice(0, MAX_SHOWS);
    const watching = ids.map((id) => ({ id, air: byId[id]?.air }));
    // Airing status isn't always known locally (older entries, other devices): ask in batches of 6.
    const unknown = watching.filter((e) => !e.air || (followed.has(e.id) && e.air !== 'FINISHED')).map((e) => e.id);
    for (let i = 0; i < unknown.length; i += 6) {
      try {
        const { results } = await api('/batch?ids=' + unknown.slice(i, i + 6).join(','));
        results.forEach((a) => store.rememberMeta(a));
      } catch { /* try again next time */ }
    }
    const rows = Object.fromEntries(store.libraryRows().map((r) => [r.id, r]));
    const airing = ids.map((id) => rows[id]).filter((e) => e?.air === 'RELEASING');
    const items = [];
    const alertsFor = store.getSettings().alertsFor || 'both';
    await eachLimited(airing, 4, async (e) => {
      const watched = [...store.watchedSet(e.id)];
      let baseline = store.followBaseline(e.id);
      if (!watched.length && !baseline && !store.followBaselineKnown(e.id)) {
        // Followed but never watched, and no baseline on this device (e.g. followed on another
        // one): start from what's out now, so only episodes after today count as new.
        if (!followed.has(e.id)) return;
        try {
          const a = await api(`/anime/${e.id}`);
          baseline = a.availableEpisodes || 0;
          store.setFollowBaseline(e.id, baseline);
        } catch { return; }
        return;
      }
      // Next episode: after the last one watched (or, for a followed show not started yet, after
      // what was out when it was followed), and after one you dismissed, so next week's shows up.
      const dismissedEp = Number((read(DISMISSED, []).find((k) => k.startsWith(`${e.id}:`)) || ':0').split(':')[1]) || 0;
      const next = Math.max(watched.length ? Math.max(...watched) : baseline, dismissedEp) + 1;
      try {
        const d = await api(`/anime/${e.id}/available?ep=${next}`);
        const ok = alertsFor === 'sub' ? d.sub : alertsFor === 'dub' ? d.dub : d.sub || d.dub;
        if (ok) items.push({ id: e.id, ep: next, title: e.title, cover: e.cover, cat: alertsFor === 'dub' || (!d.sub && d.dub) ? 'dub' : 'sub', followed: followed.has(e.id) });
      } catch { /* skip this one */ }
    });
    write(KEY, { checked: Date.now(), items });
    const visible = inboxItems();
    listeners.forEach((fn) => fn(visible));
    return visible;
  })().finally(() => { running = null; });
  return running;
}
