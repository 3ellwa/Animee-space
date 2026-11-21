// AniList lookups that have to happen in the browser: AniList refuses requests from Cloudflare's
// servers, so the Worker can't ask it. Used for VidNest/TryEmbed (they address shows by AniList ID)
// and for importing a public AniList list.

const GRAPHQL = 'https://graphql.anilist.co';
const IDS_KEY = 'animee-space:anilist-ids';
const HIT_TTL = 30 * 86400e3;  // a MAL show's AniList ID never changes
const MISS_TTL = 86400e3;      // ask again tomorrow when AniList had no match
const MAX_IDS = 800;

const read = () => { try { return JSON.parse(localStorage.getItem(IDS_KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(IDS_KEY, JSON.stringify(v)); } catch { /* full or blocked */ } };

async function graphql(query, variables, timeoutMs = 8000) {
  let r;
  try {
    r = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('AniList could not be reached. Try again in a minute.');
  }
  const data = await r.json().catch(() => null);
  const message = data?.errors?.[0]?.message || '';
  if (r.status === 404 || /not found|private/i.test(message)) return { notFound: true, data: data?.data };
  if (!r.ok || !data || data.errors?.length) {
    throw new Error(r.status === 429 ? 'AniList is busy right now. Try again in a minute.' : 'AniList returned an error. Try again later.');
  }
  return { data: data.data };
}

const pending = new Map();
/** The AniList ID for a MAL ID, or null when there's no (non-adult) match or AniList can't be reached. */
export function aniListIdFor(malId) {
  const key = String(malId);
  if (!/^\d{1,12}$/.test(key)) return Promise.resolve(null);
  const cache = read();
  const hit = cache[key];
  if (hit && hit[1] > Date.now()) return Promise.resolve(hit[0] || null);
  if (pending.has(key)) return pending.get(key);
  const p = graphql('query ($m: Int) { Media(idMal: $m, type: ANIME) { id isAdult } }', { m: Number(key) }, 5000)
    .then(({ data, notFound }) => {
      const media = data?.Media;
      const id = !notFound && media && !media.isAdult && Number.isSafeInteger(media.id) ? String(media.id) : null;
      const next = read();
      next[key] = [id, Date.now() + (id ? HIT_TTL : MISS_TTL)];
      const keys = Object.keys(next);
      if (keys.length > MAX_IDS) keys.slice(0, keys.length - MAX_IDS).forEach((k) => delete next[k]);
      write(next);
      return id;
    })
    .catch(() => null) // network trouble: no ID this time, the Worker will try (and skip these servers)
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

// ---------- importing a public AniList list ----------
// Same result shape the old /api/import/anilist route returned.
const STATUS = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'planning', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped' };
const LIST_QUERY = `query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    lists { entries { status progress media { idMal isAdult format episodes seasonYear
      title { english romaji } coverImage { large } } } }
  }
}`;

export async function importAniListUser(rawName) {
  const name = String(rawName || '').trim();
  if (!/^[A-Za-z0-9_]{2,20}$/.test(name)) throw new Error('Enter a valid AniList username.');
  const { data, notFound } = await graphql(LIST_QUERY, { name }, 15000);
  if (notFound || !data?.MediaListCollection) throw new Error('No public AniList list found for that username.');
  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const list of data.MediaListCollection.lists || []) {
    for (const entry of list.entries || []) {
      const m = entry.media || {};
      const status = STATUS[entry.status];
      if (!m.idMal || m.isAdult || !status) { skipped++; continue; }
      const id = String(m.idMal);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id, status,
        title: m.title?.english || m.title?.romaji || null,
        cover: m.coverImage?.large || null,
        format: m.format || null,
        episodes: m.episodes ?? null,
        year: m.seasonYear ?? null,
        watchedUpTo: entry.status === 'COMPLETED' ? m.episodes || entry.progress || 0 : entry.progress || 0,
      });
    }
  }
  return { user: name, items, skipped };
}
