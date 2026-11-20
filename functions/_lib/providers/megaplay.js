// Finds out which episodes MegaPlay can actually play.
// MegaPlay answers every embed URL with HTTP 200; a missing episode gets its error page
// ("Error - MegaPlay"). It only serves the real page when the request names the embedding
// site, so requests say they come from animee.space, which is where the player is shown.
const EMBED = 'https://megaplay.buzz';
const SITE = 'https://animee.space/';
const fail = (status, message) => Object.assign(new Error(message), { status });

export const probeSettings = { gapMs: 120 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let nextSlot = 0;
async function takeSlot() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + probeSettings.gapMs;
  if (start > now) await sleep(start - now);
}

const episodeCache = new Map(); // "id/ep/lang" -> { ok, expires }
const EPISODE_TTL = 30 * 60e3;

export async function isAvailable(id, episode, lang) {
  const key = `${id}/${episode}/${lang}`;
  const hit = episodeCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.ok;
  await takeSlot();
  let ok;
  try {
    const response = await fetch(`${EMBED}/stream/mal/${id}/${episode}/${lang}`, {
      headers: { Referer: SITE, 'User-Agent': 'Mozilla/5.0 (compatible; animee-space)', Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    const html = await response.text();
    ok = response.ok && !/<title>\s*Error\s*-\s*MegaPlay/i.test(html);
  } catch {
    throw fail(502, 'Could not check MegaPlay right now.');
  }
  episodeCache.set(key, { ok, expires: Date.now() + EPISODE_TTL });
  return ok;
}

// Highest episode that plays, assuming episodes 1..n are all there (they are added in order).
// Binary search: about log2(limit) checks. With no known episode count, it doubles first.
async function latest(id, lang, knownTotal) {
  if (!(await isAvailable(id, 1, lang))) return 0;
  let low = 1;
  let high;
  if (knownTotal > 1) {
    if (await isAvailable(id, knownTotal, lang)) return knownTotal;
    high = knownTotal;
  } else {
    let step = 2;
    while (step <= 2000 && (await isAvailable(id, step, lang))) { low = step; step *= 2; }
    if (step > 2000) return low;
    high = step;
  }
  // low plays, high doesn't.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await isAvailable(id, mid, lang)) low = mid; else high = mid;
  }
  return low;
}

const countCache = new Map();
const COUNT_TTL = 60 * 60e3;
export async function getAvailability(rawId, rawTotal) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const total = Math.min(2000, Math.max(0, Number(rawTotal) || 0));
  const key = `${id}/${total}`;
  const hit = countCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [sub, dub] = await Promise.all([latest(id, 'sub', total), latest(id, 'dub', total)]);
  const value = { id, sub, dub, checked: new Date().toISOString() };
  countCache.set(key, { value, expires: Date.now() + COUNT_TTL });
  return value;
}

export async function getEpisodeAvailability(rawId, rawEpisode) {
  const id = String(rawId || '').trim();
  const episode = Number(rawEpisode);
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  if (!Number.isInteger(episode) || episode < 1 || episode > 2000) throw fail(400, 'Invalid episode number');
  const [sub, dub] = await Promise.all([isAvailable(id, episode, 'sub'), isAvailable(id, episode, 'dub')]);
  return { id, episode, sub, dub };
}
