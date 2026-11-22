// aniembed.se ("Ram"): an iframe player addressed by AniList id (looked up by the visitor's
// browser, like JoJo and Hoshi). Sub or dub with `lang`, a start time with `t` (set by the
// player when resuming). It posts { source: 'aniembed', version: 1, name, data } messages
// (progress every 5 s, ended …) and takes { type: 'command', name: 'seek', data: { time } }.

import { getAniListId } from './anilist.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const BASE = 'https://aniembed.se';
const CATEGORIES = new Set(['sub', 'dub']);

export async function getSources(rawMalId, rawEpisode, category = 'sub', aniListId = null) {
  const malId = String(rawMalId || '').trim();
  const episode = Number(rawEpisode);
  const lang = String(category || 'sub').toLowerCase();
  if (!/^\d{1,12}$/.test(malId)) throw fail(400, 'Invalid MAL anime ID.');
  if (!Number.isInteger(episode) || episode < 1 || episode > 2000) throw fail(400, 'Invalid episode number.');
  if (!CATEGORIES.has(lang)) throw fail(400, 'Invalid playback category.');
  const alId = /^\d{1,9}$/.test(String(aniListId || '')) ? String(aniListId) : await getAniListId(malId);
  const url = new URL(`${BASE}/e/${encodeURIComponent(alId)}/${episode}`);
  url.searchParams.set('lang', lang);
  url.searchParams.set('autoplay', '1');
  return { embedUrl: url.toString(), embedOrigin: BASE, language: lang, provider: 'aniembed', events: [] };
}

// Whether it has the episode: its page says "Couldn't load the player" (API responded with 404)
// for one it doesn't have. Kept for 30 minutes; when it can't be reached it counts as an outage.
const checks = new Map();
export async function isAvailable(malId, episode, category = 'sub', aniListId = null) {
  let alId;
  try { alId = /^\d{1,9}$/.test(String(aniListId || '')) ? String(aniListId) : await getAniListId(String(malId)); }
  catch { return false; } // no AniList id: this server can't be addressed
  const key = `${alId}/${episode}/${category}`;
  const hit = checks.get(key);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = true;
  try {
    const r = await fetch(`${BASE}/e/${encodeURIComponent(alId)}/${Number(episode)}?lang=${category === 'dub' ? 'dub' : 'sub'}`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; animee-space)' }, signal: AbortSignal.timeout(5000),
    });
    if (r.status >= 500) throw Object.assign(new Error('This server is having trouble.'), { status: 502 });
    const html = await r.text();
    ok = r.status !== 404 && !/Couldn.t load the player/i.test(html);
  } catch {
    // No answer: an outage (counted by the fallback's breaker), not "available".
    throw Object.assign(new Error('Could not check this server right now.'), { status: 502 });
  }
  if (checks.size > 2000) checks.clear();
  checks.set(key, { ok, expires: Date.now() + 30 * 60 * 1000 });
  return ok;
}
export function resetChecks() { checks.clear(); }
