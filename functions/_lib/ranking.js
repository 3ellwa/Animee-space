// Servers that sort themselves: the "didn't play" reports (see reports.js) push a server down
// the try-order for one episode, or for a whole show, when it keeps failing there.
//
// - One episode: 2 or more reports in the last 3 days demote that server for that episode.
// - One show: failures on 3 or more different episodes within 2 days demote it for the show (an
//   outage; scattered failures on a long, busy show over a week don't count).
//
// The lookup reads the reports table by its primary-key prefix (anime_id), so it stays cheap,
// and the answer is kept in memory for 10 minutes. With no database, or no reports table yet,
// nothing is demoted.

const EPISODE_DAYS = 3;
const SHOW_DAYS = 2;
const EPISODE_LIMIT = 2;
const SHOW_LIMIT = 3;
const CACHE_MS = 10 * 60 * 1000;
const memo = new Map();

export function resetRankingCache() { memo.clear(); }

/** rows: [{ ep, provider, cat (0 sub, 1 dub), n, day }] → Set of "provider:category" to demote. */
export function demotedFrom(rows, episode, today) {
  const epFails = new Map();
  const showEps = new Map();
  for (const row of rows) {
    const key = `${row.provider}:${Number(row.cat) === 1 ? 'dub' : 'sub'}`;
    if (Number(row.day) >= today - SHOW_DAYS) {
      if (!showEps.has(key)) showEps.set(key, new Set());
      showEps.get(key).add(Number(row.ep));
    }
    if (Number(row.ep) === Number(episode) && Number(row.day) >= today - EPISODE_DAYS) {
      epFails.set(key, (epFails.get(key) || 0) + Number(row.n || 0));
    }
  }
  const out = new Set();
  for (const [key, n] of epFails) if (n >= EPISODE_LIMIT) out.add(key);
  for (const [key, eps] of showEps) if (eps.size >= SHOW_LIMIT) out.add(key);
  return out;
}

export async function demotedServers(env, animeId, episode) {
  if (!env?.DB?.prepare) return new Set();
  const today = Math.floor(Date.now() / 86400000);
  const key = `${env.SITE || 'animee'}:${animeId}:${episode}`;
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = new Set();
  try {
    const { results } = await env.DB.prepare(
      'SELECT ep, provider, cat, day, SUM(n) AS n FROM reports WHERE anime_id = ? AND day >= ? GROUP BY ep, provider, cat, day',
    ).bind(Number(animeId), today - Math.max(SHOW_DAYS, EPISODE_DAYS)).all();
    value = demotedFrom(results || [], episode, today);
  } catch { /* no reports table yet: nothing to demote */ }
  if (memo.size > 2000) memo.clear();
  memo.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
}

/** Keeps the chosen order, but moves demoted servers to the end (in their original order). */
export function rankServers(servers, demoted) {
  if (!demoted?.size) return servers;
  const mark = (s) => demoted.has(`${s.id}:${s.category}`);
  return [
    ...servers.filter((s) => !mark(s)),
    ...servers.filter(mark).map((s) => ({ ...s, struggling: true })),
  ];
}

// ---------- admin ----------
/**
 * Everything demoted right now: [{ anime, ep (null = whole show), provider, category, n }],
 * worked out with the same rules as playback. For the admin page.
 */
export async function demotedList(env) {
  if (!env?.DB?.prepare) return [];
  const today = Math.floor(Date.now() / 86400000);
  let rows = [];
  try {
    ({ results: rows } = await env.DB.prepare(
      'SELECT anime_id, ep, provider, cat, day, SUM(n) AS n FROM reports WHERE day >= ? GROUP BY anime_id, ep, provider, cat, day',
    ).bind(today - Math.max(SHOW_DAYS, EPISODE_DAYS)).all());
  } catch { return []; }
  const byShow = new Map();
  for (const r of rows || []) {
    if (!byShow.has(r.anime_id)) byShow.set(r.anime_id, []);
    byShow.get(r.anime_id).push(r);
  }
  const out = [];
  for (const [anime, list] of byShow) {
    const shown = new Set();
    // Whole-show demotions first (they cover every episode).
    for (const key of demotedFrom(list, -1, today)) {
      const [provider, category] = key.split(':');
      const n = list.filter((r) => r.provider === provider && (Number(r.cat) === 1 ? 'dub' : 'sub') === category).reduce((t, r) => t + Number(r.n), 0);
      out.push({ anime: String(anime), ep: null, provider, category, n });
      shown.add(key);
    }
    for (const ep of new Set(list.map((r) => Number(r.ep)))) {
      for (const key of demotedFrom(list.filter((r) => Number(r.ep) === ep), ep, today)) {
        if (shown.has(key)) continue;
        const [provider, category] = key.split(':');
        const n = list.filter((r) => Number(r.ep) === ep && r.provider === provider && (Number(r.cat) === 1 ? 'dub' : 'sub') === category).reduce((t, r) => t + Number(r.n), 0);
        out.push({ anime: String(anime), ep, provider, category, n });
      }
    }
  }
  return out.sort((x, y) => y.n - x.n).slice(0, 200);
}

/** A false alarm: forget the reports behind one demotion (one episode, or the whole show). */
export async function clearDemotion(env, { anime, ep, provider, category }) {
  const id = String(anime ?? '');
  if (!/^\d{1,12}$/.test(id) || !/^[a-z0-9_-]{1,40}$/.test(String(provider || ''))) {
    throw Object.assign(new Error('Need a show id and a server'), { status: 400 });
  }
  const cat = category === 'dub' ? 1 : 0;
  const episode = ep === null || ep === undefined || ep === '' ? null : Number(ep);
  if (episode !== null) {
    await env.DB.prepare('DELETE FROM reports WHERE anime_id = ? AND ep = ? AND provider = ? AND cat = ?').bind(Number(id), episode, provider, cat).run();
  } else {
    await env.DB.prepare('DELETE FROM reports WHERE anime_id = ? AND provider = ? AND cat = ?').bind(Number(id), provider, cat).run();
  }
  // This copy of the Worker forgets at once; others within 10 minutes.
  for (const key of memo.keys()) if (key.includes(`:${id}:`)) memo.delete(key);
}
