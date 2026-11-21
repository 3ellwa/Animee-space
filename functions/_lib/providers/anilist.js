// Resolve the AniList ID required by external embed providers from Animee's MAL IDs.
// Positive mappings are cached for a day; misses are cached briefly to avoid hammering AniList.
const GRAPHQL = 'https://graphql.anilist.co';
const positive = new Map();
const negative = new Map();
const POSITIVE_TTL = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;
function putBounded(cache, key, value) {
  if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function getAniListId(rawMalId) {
  const malId = String(rawMalId || '').trim();
  if (!/^\d{1,12}$/.test(malId)) throw fail(400, 'Invalid MAL anime ID.');

  const cached = positive.get(malId);
  if (cached && cached.expires > Date.now()) return cached.id;
  if (cached) positive.delete(malId);
  const miss = negative.get(malId);
  if (miss && miss > Date.now()) throw fail(404, 'AniList has no matching anime for this title.');
  if (miss) negative.delete(malId);

  const query = `query ($malId: Int) {
    Media(idMal: $malId, type: ANIME) { id idMal isAdult }
  }`;
  let response;
  try {
    response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables: { malId: Number(malId) } }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    throw fail(502, 'Could not reach AniList to match this title.');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.errors?.length) {
    const status = response.status === 429 ? 503 : response.status >= 500 ? 502 : 502;
    throw fail(status, 'AniList could not resolve this title right now.');
  }

  const media = payload.data?.Media;
  const id = Number(media?.id);
  if (!Number.isSafeInteger(id) || id < 1 || media?.isAdult === true) {
    putBounded(negative, malId, Date.now() + NEGATIVE_TTL);
    throw fail(404, 'AniList has no matching anime for this title.');
  }
  putBounded(positive, malId, { id: String(id), expires: Date.now() + POSITIVE_TTL });
  return String(id);
}

// Test-only reset is intentionally exported so tests don't depend on prior mappings.
export function resetAniListCache() {
  positive.clear();
  negative.clear();
}
