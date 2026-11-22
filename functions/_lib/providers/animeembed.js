// animeembed.com ("Rem"): an iframe player addressed by MyAnimeList id, the id animee already
// uses, so no AniList lookup is needed. Sub or dub with `track`; it takes a start time (`start`,
// set by the player when resuming), skips intros itself (`autoSkip`), and its own auto-next is
// turned off so animee's Up next stays in charge. It reports ready/play/pause/progress/ended
// through postMessage ({ channel: 'animeembed', version: 1, event, data }) and takes play,
// pause and seek commands, so watch parties can follow it. Unknown options make it answer 400,
// so only documented ones are sent. Its operator may show ads; it can't run sandboxed.

const fail = (status, message) => Object.assign(new Error(message), { status });
const BASE = 'https://animeembed.com';
const CATEGORIES = new Set(['sub', 'dub']);

export function getSources(rawMalId, rawEpisode, category = 'sub', { accent = 'C6FF3D' } = {}) {
  const malId = String(rawMalId || '').trim();
  const episode = Number(rawEpisode);
  const track = String(category || 'sub').toLowerCase();
  if (!/^\d{1,12}$/.test(malId)) throw fail(400, 'Invalid MAL anime ID.');
  if (!Number.isInteger(episode) || episode < 1 || episode > 2000) throw fail(400, 'Invalid episode number.');
  if (!CATEGORIES.has(track)) throw fail(400, 'Invalid playback category.');
  const url = new URL(`${BASE}/embed/mal/${encodeURIComponent(malId)}/${episode}`);
  url.searchParams.set('track', track);
  url.searchParams.set('autoPlay', '1');
  url.searchParams.set('autoNext', '0');
  url.searchParams.set('autoSkip', '1');
  url.searchParams.set('accent', accent);
  return { embedUrl: url.toString(), embedOrigin: BASE, language: track, provider: 'animeembed', events: [] };
}

// Whether the show exists there: its embed page answers 404 for a show it doesn't know. (A
// missing episode of a known show can't be told apart here; the watch page moves on when the
// player never says it's ready.) Kept for 30 minutes; when it can't be reached it counts as an outage.
const checks = new Map();
export async function isAvailable(malId, episode, category = 'sub') {
  const key = `${malId}/${episode}/${category}`;
  const hit = checks.get(key);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = true;
  try {
    const r = await fetch(`${BASE}/embed/mal/${encodeURIComponent(malId)}/${Number(episode)}?track=${category === 'dub' ? 'dub' : 'sub'}`, {
      headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; animee-space)' }, signal: AbortSignal.timeout(5000),
    });
    if (r.status >= 500) throw Object.assign(new Error('This server is having trouble.'), { status: 502 });
    ok = r.status !== 404;
  } catch {
    // No answer: an outage (counted by the fallback's breaker), not "available".
    throw Object.assign(new Error('Could not check this server right now.'), { status: 502 });
  }
  if (checks.size > 2000) checks.clear();
  checks.set(key, { ok, expires: Date.now() + 30 * 60 * 1000 });
  return ok;
}
