// AniList metadata/search with MegaPlay playback by AniList ID + episode number.
// Adult catalogue entries are excluded at the API query and detail layers.
const API = 'https://graphql.anilist.co';
const EMBED = 'https://megaplay.buzz';
const fail = (status, message) => Object.assign(new Error(message), { status });
const MEDIA_FIELDS = `
  id
  idMal
  title { english romaji native }
  coverImage { extraLarge large medium color }
  bannerImage
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  popularity
  genres
  description
  isAdult
  startDate { year month day }
  endDate { year month day }
  nextAiringEpisode { airingAt timeUntilAiring episode }
  studios(isMain: true) { nodes { name } }
  source
  synonyms
  trailer { id site }
`;
const stripHtml = value => String(value || '')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const validId = value => {
  const id = String(value ?? '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid AniList anime ID');
  return id;
};
function normalizeAnime(raw) {
  const a = raw || {};
  const title = first(a.title?.english, a.title?.romaji, a.title?.native, 'Untitled');
  const episodes = Number(a.episodes) || 0;
  return {
    id: String(a.id),
    malId: a.idMal ?? null,
    title,
    titleRomaji: first(a.title?.romaji, null),
    titleNative: first(a.title?.native, null),
    cover: first(a.coverImage?.extraLarge, a.coverImage?.large, a.coverImage?.medium, null),
    banner: first(a.bannerImage, a.coverImage?.extraLarge, a.coverImage?.large, null),
    color: a.coverImage?.color || null,
    format: a.format || null,
    status: a.status || null,
    episodes,
    availableEpisodes: episodes,
    duration: Number(a.duration) || null,
    score: Number(a.averageScore) ? Number(a.averageScore) / 10 : null,
    popularity: Number(a.popularity) || null,
    season: a.season || null,
    year: Number(a.seasonYear || a.startDate?.year) || null,
    genres: Array.isArray(a.genres) ? a.genres : [],
    nextAiring: a.nextAiringEpisode ? {
      airingAt: a.nextAiringEpisode.airingAt,
      timeUntilAiring: a.nextAiringEpisode.timeUntilAiring,
      episode: a.nextAiringEpisode.episode,
    } : null,
    description: stripHtml(a.description),
    studios: (a.studios?.nodes || []).map(node => node?.name).filter(Boolean),
    characters: [],
    relations: [],
    recommendations: [],
    streamingLinks: [],
    source: a.source || null,
    synonyms: Array.isArray(a.synonyms) ? a.synonyms : [],
    trailer: a.trailer?.site === 'youtube' ? a.trailer.id : null,
    startDate: a.startDate || null,
    endDate: a.endDate || null,
    adultContent: false,
  };
}
async function graphql(query, variables = {}) {
  let response;
  try {
    response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw fail(502, 'AniList is temporarily unreachable');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
    throw fail(status, 'AniList API returned HTTP ' + response.status);
  }
  if (!payload || !payload.data || payload.errors?.length) {
    const detail = payload?.errors?.map(error => error.message).filter(Boolean).join('; ');
    throw fail(502, detail ? 'AniList API error: ' + detail.slice(0, 180) : 'AniList returned an invalid response');
  }
  return payload.data;
}
const mediaCache = new Map();
async function fetchMedia(id) {
  const key = String(id);
  const cached = mediaCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const query = `query ($id: Int!) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`;
  const pending = graphql(query, { id: Number(key) }).then(data => {
    const media = data.Media;
    if (!media) throw fail(404, 'Anime not found');
    if (media.isAdult) throw fail(404, 'This title is unavailable');
    return media;
  });
  mediaCache.set(key, { value: pending, expires: Date.now() + 300000 });
  try {
    const media = await pending;
    mediaCache.set(key, { value: media, expires: Date.now() + 300000 });
    return media;
  } catch (error) {
    mediaCache.delete(key);
    throw error;
  }
}
export async function getHome() {
  const query = `query { Page(page: 1, perPage: 24) {
    pageInfo { currentPage lastPage hasNextPage total }
    media(type: ANIME, isAdult: false, sort: [TRENDING_DESC, POPULARITY_DESC]) { ${MEDIA_FIELDS} }
  } }`;
  const data = await graphql(query);
  const page = data.Page;
  return { recent: (page.media || []).filter(a => !a.isAdult).map(normalizeAnime), pagination: page.pageInfo };
}
export async function searchAnime({ query = '', genre = '', page = 1 } = {}) {
  const pageNumber = Math.min(500, Math.max(1, Number(page) || 1));
  const search = String(query || '').trim().slice(0, 100);
  const selectedGenre = String(genre || '').trim().slice(0, 50);
  const genres = selectedGenre ? [selectedGenre] : null;
  const sort = search ? 'SEARCH_MATCH' : 'POPULARITY_DESC';
  const gql = `query ($page: Int!, $perPage: Int!, $search: String, $genres: [String]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { currentPage lastPage hasNextPage total }
      media(type: ANIME, isAdult: false, search: $search, genre_in: $genres, sort: [${sort}]) { ${MEDIA_FIELDS} }
    }
  }`;
  const data = await graphql(gql, { page: pageNumber, perPage: 24, search: search || null, genres });
  const info = data.Page.pageInfo || {};
  return {
    results: (data.Page.media || []).filter(a => !a.isAdult).map(normalizeAnime),
    pageInfo: {
      currentPage: info.currentPage || pageNumber,
      lastPage: info.lastPage || 1,
      hasNextPage: !!info.hasNextPage,
      total: info.total || 0,
    },
  };
}
export async function getAnime(rawId) {
  return normalizeAnime(await fetchMedia(validId(rawId)));
}
const seriesCache = new Map();
export async function getSeries(rawId) {
  const id = validId(rawId);
  const cached = seriesCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = (async () => {
    const media = await fetchMedia(id);
    const anime = normalizeAnime(media);
    const listed = Number(media.episodes) || 0;
    const nextEpisode = Number(media.nextAiringEpisode?.episode) || 0;
    const available = nextEpisode > 0 ? Math.min(listed || nextEpisode - 1, nextEpisode - 1) : listed;
    const total = Math.max(0, Math.min(5000, available));
    const episodes = Array.from({ length: total }, (_, index) => {
      const number = index + 1;
      return {
        id: id + ':' + number,
        number,
        title: 'Episode ' + number,
        isFiller: false,
        embedId: String(number),
        hasSub: true,
        hasDub: true,
      };
    });
    anime.episodes = total;
    anime.availableEpisodes = total;
    return { anime, episodes };
  })();
  seriesCache.set(id, { value: pending, expires: Date.now() + 300000 });
  try {
    const result = await pending;
    seriesCache.set(id, { value: result, expires: Date.now() + 300000 });
    return result;
  } catch (error) {
    seriesCache.delete(id);
    throw error;
  }
}
export async function getServers(animeId, episodeRef) {
  const id = validId(animeId);
  const number = Number(episodeRef);
  if (!Number.isInteger(number) || number < 1) throw fail(400, 'Invalid episode number');
  const { episodes } = await getSeries(id);
  if (!episodes.some(episode => episode.number === number)) throw fail(404, 'Episode is not listed for this anime');
  return [
    { id: 'sub', name: 'Sub', category: 'sub', available: true },
    { id: 'dub', name: 'Dub', category: 'dub', available: true },
  ];
}
export async function getSources(animeId, episodeRef, language = 'sub') {
  const id = validId(animeId);
  const number = Number(episodeRef);
  if (!Number.isInteger(number) || number < 1) throw fail(400, 'Invalid episode number');
  const { episodes } = await getSeries(id);
  if (!episodes.some(episode => episode.number === number)) throw fail(404, 'Episode is not listed for this anime');
  const lang = language === 'dub' ? 'dub' : 'sub';
  const url = EMBED + '/stream/ani/' + id + '/' + number + '/' + lang;
  return {
    embedUrl: url,
    embedOrigin: new URL(url).origin,
    language: lang,
    events: ['time', 'complete', 'error', 'watching-log'],
  };
}
