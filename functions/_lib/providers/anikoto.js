// Anikoto catalog + MegaPlay embedded playback provider.
// Anime metadata is still sourced from AniList; video is embedded from MegaPlay.

const EMBED_BASE = 'https://megaplay.buzz';
const CATALOG_BASE = 'https://anikotoapi.site';

function episodeCount(anime) {
  return Math.max(0, Math.min(Number(anime.availableEpisodes ?? anime.episodes ?? 0) || 0, 3000));
}

export const name = 'anikoto';
export const label = 'Anikoto / MegaPlay';

export async function getEpisodes(anime) {
  const count = episodeCount(anime);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `${anime.id}-${number}`,
      number,
      title: anime.format === 'MOVIE' && count === 1 ? anime.title : `Episode ${number}`,
      isFiller: false,
      hasSub: true,
      hasDub: true,
    };
  });
}

export async function getServers(episodeId) {
  const match = /^(\d+)-(\d+)$/.exec(String(episodeId));
  if (!match) throw Object.assign(new Error('Invalid episode id'), { status: 400 });
  return [
    { id: 'sub', name: 'MegaPlay', category: 'sub' },
    { id: 'dub', name: 'MegaPlay', category: 'dub' },
  ];
}

export async function getSources(episodeId, { category = 'sub' } = {}) {
  const match = /^(\d+)-(\d+)$/.exec(String(episodeId));
  if (!match) throw Object.assign(new Error('Invalid episode id'), { status: 400 });
  const [, anilistId, episode] = match;
  const language = category === 'dub' ? 'dub' : 'sub';
  return {
    embedUrl: `${EMBED_BASE}/stream/ani/${anilistId}/${episode}/${language}`,
    embedOrigin: EMBED_BASE,
    language,
    events: ['time', 'complete', 'error', 'watching-log'],
  };
}

export async function getRecentAnime({ page = 1, perPage = 20 } = {}) {
  const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  const response = await fetch(`${CATALOG_BASE}/recent-anime?${qs}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`Anikoto API returned HTTP ${response.status}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}

export async function getSeries(id) {
  if (!/^\d+$/.test(String(id))) throw Object.assign(new Error('Invalid Anikoto series id'), { status: 400 });
  const response = await fetch(`${CATALOG_BASE}/series/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`Anikoto API returned HTTP ${response.status}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return response.json();
}
