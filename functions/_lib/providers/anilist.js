// Wide banner art for the home spotlight. Tenrai only has portrait covers, which look blurry
// when stretched across a wide hero, so the spotlight asks AniList's public GraphQL API
// (free, no key) for each show's banner by MAL ID. Missing banners are fine: the page falls
// back to the cover.
const ANILIST = 'https://graphql.anilist.co';
const QUERY = 'query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal bannerImage } } }';
const TTL = 6 * 60 * 60 * 1000;
const cache = new Map(); // MAL id -> { url, expires }

/** Returns { [malId]: bannerUrl } for the IDs AniList has a banner for. Never throws. */
export async function getBanners(rawIds, { timeoutMs = 4000 } = {}) {
  const ids = [...new Set(rawIds.map(Number).filter(id => Number.isInteger(id) && id > 0))].slice(0, 50);
  const result = {};
  const missing = [];
  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && hit.expires > Date.now()) { if (hit.url) result[id] = hit.url; }
    else missing.push(id);
  }
  if (!missing.length) return result;
  try {
    const response = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { ids: missing } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return result;
    const payload = await response.json().catch(() => null);
    const found = new Map();
    // One MAL ID can map to more than one AniList entry; keep the first real banner.
    for (const media of payload?.data?.Page?.media || []) {
      const url = typeof media?.bannerImage === 'string' && /^https:\/\//.test(media.bannerImage) ? media.bannerImage : null;
      if (url && !found.has(media.idMal)) found.set(media.idMal, url);
    }
    for (const id of missing) {
      const url = found.get(id) || null;
      cache.set(id, { url, expires: Date.now() + TTL });
      if (url) result[id] = url;
    }
  } catch { /* AniList is optional decoration */ }
  return result;
}
