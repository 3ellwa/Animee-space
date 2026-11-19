// Tenrai catalogue + MegaPlay embeds. Tenrai follows the Jikan v4 response schema.
const API = 'https://api.tenrai.org/v1';
const EMBED = 'https://megaplay.buzz';
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' ? value.trim() : '';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');

const GENRE_IDS = {
  Action: 1, Adventure: 2, Comedy: 4, Drama: 8, Fantasy: 10, Horror: 14,
  Mecha: 18, Music: 19, Mystery: 7, Romance: 22, 'Sci-Fi': 24,
  'Slice of Life': 36, Sports: 30, Supernatural: 37, Thriller: 41,
};
const THEME_IDS = { Psychological: 40, 'Mahou Shoujo': 66 };

function dateParts(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function listData(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}
function pageInfo(payload, page) {
  const pagination = payload?.pagination || {};
  const currentPage = number(pagination.current_page) || page;
  const lastPage = number(pagination.last_visible_page ?? pagination.last_page) || currentPage;
  return {
    currentPage,
    lastPage,
    hasNextPage: typeof pagination.has_next_page === 'boolean' ? pagination.has_next_page : currentPage < lastPage,
    total: number(pagination.items?.total) || null,
  };
}
function imageOf(anime) {
  return first(
    anime?.images?.webp?.large_image_url,
    anime?.images?.jpg?.large_image_url,
    anime?.images?.webp?.image_url,
    anime?.images?.jpg?.image_url,
    null,
  );
}
function statusOf(value) {
  const key = String(value || '').toLowerCase();
  if (key === 'currently airing') return 'RELEASING';
  if (key === 'finished airing') return 'FINISHED';
  if (key === 'not yet aired') return 'NOT_YET_RELEASED';
  return key ? key.toUpperCase().replaceAll(' ', '_') : null;
}
function dateOf(anime, edge) {
  return dateParts(anime?.aired?.[edge] || anime?.published?.[edge]);
}
function formatOf(value) {
  const key = String(value || '').toUpperCase().replace(/[^A-Z_]/g, '');
  return key || null;
}
function normalizeRelated(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap(group => (Array.isArray(group?.entry) ? group.entry : []).map(entry => {
    const id = first(entry?.mal_id, entry?.id);
    if (id == null) return null;
    return {
      id: String(id),
      title: text(entry?.name) || 'Related anime',
      titleRomaji: text(entry?.name),
      titleNative: null,
      cover: imageOf(entry),
      banner: imageOf(entry),
      color: null,
      format: formatOf(entry?.type),
      status: null,
      episodes: 0,
      availableEpisodes: 0,
      duration: null,
      score: null,
      popularity: null,
      season: null,
      year: null,
      genres: [],
      description: '',
      studios: [],
      characters: [],
      relations: [],
      recommendations: [],
      streamingLinks: [],
      source: null,
      synonyms: [],
      trailer: null,
      startDate: null,
      endDate: null,
    };
  }).filter(Boolean));
}
export function normalizeAnime(raw) {
  const anime = raw?.data && raw?.mal_id == null ? raw.data : (raw || {});
  const id = first(anime.mal_id, anime.id);
  const title = first(text(anime.title_english), text(anime.title), text(anime.title_japanese), 'Untitled');
  const durationMatch = String(anime.duration || '').match(/(\d+)\s*min/i);
  const studios = Array.isArray(anime.studios) ? anime.studios.map(studio => text(studio?.name)).filter(Boolean) : [];
  const genres = Array.isArray(anime.genres) ? anime.genres.map(genre => text(genre?.name)).filter(Boolean) : [];
  const trailer = text(anime.trailer?.youtube_id);
  const image = imageOf(anime);
  return {
    id: id == null ? null : String(id),
    malId: id == null ? null : Number(id),
    title,
    titleRomaji: first(text(anime.title_japanese), text(anime.title), null),
    titleNative: text(anime.title_japanese) || null,
    cover: image,
    banner: first(anime.trailer?.images?.maximum_image_url, image),
    color: null,
    format: formatOf(anime.type),
    status: statusOf(anime.status),
    episodes: number(anime.episodes),
    availableEpisodes: number(anime.episodes),
    duration: durationMatch ? Number(durationMatch[1]) : null,
    score: anime.score == null ? null : number(anime.score) * 10,
    popularity: number(anime.members) || null,
    season: text(anime.season).toUpperCase() || null,
    year: number(anime.year || anime.aired?.prop?.from?.year) || null,
    genres,
    nextAiring: null,
    description: String(anime.synopsis || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
    studios,
    characters: [],
    relations: normalizeRelated(anime.relations),
    recommendations: [],
    streamingLinks: Array.isArray(anime.streaming)
      ? anime.streaming.map(item => ({ site: text(item?.name), url: text(item?.url) })).filter(item => item.site && item.url)
      : [],
    source: text(anime.source) || null,
    synonyms: Array.isArray(anime.title_synonyms) ? anime.title_synonyms.map(text).filter(Boolean) : [],
    trailer: trailer || null,
    startDate: dateOf(anime, 'from'),
    endDate: dateOf(anime, 'to'),
    rating: text(anime.rating),
  };
}

export async function request(path) {
  const response = await fetch(API + path, { headers: { Accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
    throw fail(status, first(payload?.message, payload?.error, 'Tenrai API returned HTTP ' + response.status));
  }
  if (!payload || payload.status === 'error') {
    throw fail(502, first(payload?.message, 'Tenrai returned an invalid response'));
  }
  return payload;
}

export async function getSeasonalAnime() {
  const payload = await request('/seasons/now?limit=24&sfw-strict=true');
  return { results: listData(payload).map(normalizeAnime).filter(anime => anime.id), pagination: pageInfo(payload, 1) };
}

export async function searchAnime({ query = '', genre = '', page = 1 } = {}) {
  const params = new URLSearchParams({ limit: '24', page: String(page), 'sfw-strict': 'true' });
  if (query) params.set('q', query);
  if (!query && !genre) {
    params.set('order_by', 'popularity');
    params.set('sort', 'asc');
  }
  if (GENRE_IDS[genre]) params.set('genres', String(GENRE_IDS[genre]));
  else if (THEME_IDS[genre]) params.set('themes', String(THEME_IDS[genre]));
  const payload = await request('/anime?' + params.toString());
  return { results: listData(payload).map(normalizeAnime).filter(anime => anime.id), pageInfo: pageInfo(payload, page) };
}

const detailCache = new Map();
export async function getAnime(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const cached = detailCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = (async () => {
    const payload = await request('/anime/' + encodeURIComponent(id) + '/full?sfw-strict=true');
    const anime = normalizeAnime(payload?.data || payload);
    if (!anime.id) anime.id = id;
    const rating = anime.rating.toLowerCase();
    if (rating.includes('r+') || rating.includes('rx') || rating.includes('hentai') || rating.includes('erotica')) {
      throw fail(404, 'This title is not available in Animee.');
    }
    return anime;
  })();
  detailCache.set(id, { value: pending, expires: Date.now() + 600000 });
  try {
    const result = await pending;
    detailCache.set(id, { value: result, expires: Date.now() + 600000 });
    return result;
  } catch (error) {
    detailCache.delete(id);
    throw error;
  }
}

const episodeCache = new Map();
export async function getEpisodes(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const cached = episodeCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = (async () => {
    const [anime, payload] = await Promise.all([
      getAnime(id),
      request('/anime/' + encodeURIComponent(id) + '/episodes?page=1&limit=25&sfw-strict=true').catch(() => null),
    ]);
    const rows = listData(payload);
    const total = Math.min(2000, Math.max(number(anime.availableEpisodes), number(payload?.pagination?.items?.total), rows.length));
    const byNumber = new Map();
    rows.forEach((row, index) => {
      const episodeNumber = number(row?.mal_id ?? row?.episode) || index + 1;
      byNumber.set(episodeNumber, row);
    });
    const episodes = Array.from({ length: total }, (_, index) => {
      const episodeNumber = index + 1;
      const row = byNumber.get(episodeNumber);
      return {
        id: id + ':' + episodeNumber,
        number: episodeNumber,
        title: text(row?.title) || 'Episode ' + episodeNumber,
        isFiller: row?.filler === true,
        isRecap: row?.recap === true,
      };
    });
    return { animeId: id, total: episodes.length, episodes };
  })();
  episodeCache.set(id, { value: pending, expires: Date.now() + 600000 });
  try {
    const result = await pending;
    episodeCache.set(id, { value: result, expires: Date.now() + 600000 });
    return result;
  } catch (error) {
    episodeCache.delete(id);
    throw error;
  }
}

function episodeNumber(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 2000) throw fail(400, 'Invalid episode number');
  return value;
}
export async function getServers(rawId, rawEpisode) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  episodeNumber(rawEpisode);
  return [
    { id: 'sub', name: 'Sub', category: 'sub', available: true },
    { id: 'dub', name: 'Dub', category: 'dub', available: true },
  ];
}
export async function getSources(rawId, rawEpisode, language = 'sub') {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const episode = episodeNumber(rawEpisode);
  const lang = language === 'dub' ? 'dub' : 'sub';
  const embedUrl = EMBED + '/stream/mal/' + encodeURIComponent(id) + '/' + episode + '/' + lang;
  return { embedUrl, embedOrigin: EMBED, language: lang, events: ['time', 'complete', 'error', 'watching-log'] };
}
