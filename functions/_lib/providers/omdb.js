// IMDb, Rotten Tomatoes and Metacritic scores for cinemee's titles, from OMDb (omdbapi.com).
// Needs the OMDB_KEY secret (a free key allows 1,000 lookups a day); without it only the IMDb
// link is shown. Answers are kept for a day here, and title extras are edge-cached for an hour.

const DAY_MS = 86400e3;
const cache = new Map();
export function resetCache() { cache.clear(); }

/** { imdb: { score, votes }, rottenTomatoes, metacritic } (fields may be null), or null. */
export async function ratings(imdbId, key) {
  if (!key || !/^tt\d{5,10}$/.test(String(imdbId || ''))) return null;
  const hit = cache.get(imdbId);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = null;
  try {
    const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(5000) });
    const data = response.ok ? await response.json() : null;
    if (data?.Response === 'True') {
      const source = (name) => (data.Ratings || []).find((r) => r.Source === name)?.Value || null;
      const imdb = Number(data.imdbRating);
      value = {
        imdb: Number.isFinite(imdb) ? { score: imdb, votes: Number(String(data.imdbVotes || '').replace(/,/g, '')) || null } : null,
        rottenTomatoes: /^\d{1,3}%$/.test(source('Rotten Tomatoes') || '') ? source('Rotten Tomatoes') : null,
        metacritic: /^\d{1,3}$/.test(String(data.Metascore || '')) ? Number(data.Metascore) : null,
      };
    }
  } catch { /* no scores this time */ }
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  cache.set(imdbId, { value, expires: Date.now() + (value ? DAY_MS : DAY_MS / 8) });
  return value;
}
