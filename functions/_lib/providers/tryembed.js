import { getAniListId } from './anilist.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const BASE = 'https://tryembed.us.cc';
const CATEGORIES = new Set(['sub', 'dub']);

// aniListId: found by the visitor's browser (AniList refuses Cloudflare's servers); when it's
// missing, the Worker asks AniList itself (works in local development).
export async function getSources(rawMalId, rawEpisode, category = 'sub', aniListId = null) {
  const malId = String(rawMalId || '').trim();
  const episode = Number(rawEpisode);
  const language = String(category || 'sub').toLowerCase();
  if (!/^\d{1,12}$/.test(malId)) throw fail(400, 'Invalid MAL anime ID.');
  if (!Number.isInteger(episode) || episode < 1 || episode > 2000) throw fail(400, 'Invalid episode number.');
  if (!CATEGORIES.has(language)) throw fail(400, 'Invalid playback category.');

  const alId = /^\d{1,9}$/.test(String(aniListId || '')) ? String(aniListId) : await getAniListId(malId);
  const embedUrl = `${BASE}/embed/anime/${encodeURIComponent(alId)}/${episode}/${language}`;
  return {
    embedUrl,
    embedOrigin: BASE,
    language,
    provider: 'tryembed',
    events: [],
  };
}
