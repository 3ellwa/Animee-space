// Tenrai catalogue + MegaPlay embeds. Tenrai follows the Jikan v4 response schema.
const API = 'https://api.tenrai.org/v1';
const EMBED = 'https://megaplay.buzz';
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' ? value.trim() : '';
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const first = (...values) => values.find(value => value !== undefined && value !== null && value !== '');

// MAL genre, theme and demographic IDs. Ecchi (9), Erotica (49) and Hentai (12) are left out on purpose.
export const GENRES = [
  ['Action', 1], ['Adventure', 2], ['Avant Garde', 5], ['Award Winning', 46], ['Boys Love', 28], ['Comedy', 4],
  ['Drama', 8], ['Fantasy', 10], ['Girls Love', 26], ['Gourmet', 47], ['Horror', 14], ['Mystery', 7],
  ['Romance', 22], ['Sci-Fi', 24], ['Slice of Life', 36], ['Sports', 30], ['Supernatural', 37], ['Suspense', 41],
  ['Adult Cast', 50], ['Anthropomorphic', 51], ['CGDCT', 52], ['Childcare', 53], ['Combat Sports', 54],
  ['Crossdressing', 81], ['Delinquents', 55], ['Detective', 39], ['Educational', 56], ['Gag Humor', 57],
  ['Gore', 58], ['Harem', 35], ['High Stakes Game', 59], ['Historical', 13], ['Idols (Female)', 60],
  ['Idols (Male)', 61], ['Isekai', 62], ['Iyashikei', 63], ['Love Polygon', 64], ['Love Status Quo', 74],
  ['Magical Sex Shift', 65], ['Mahou Shoujo', 66], ['Martial Arts', 17], ['Mecha', 18], ['Medical', 67],
  ['Military', 38], ['Music', 19], ['Mythology', 6], ['Organized Crime', 68], ['Otaku Culture', 69],
  ['Parody', 20], ['Performing Arts', 70], ['Pets', 71], ['Psychological', 40], ['Racing', 3],
  ['Reincarnation', 72], ['Reverse Harem', 73], ['Samurai', 21], ['School', 23], ['Showbiz', 75], ['Space', 29],
  ['Strategy Game', 11], ['Super Power', 31], ['Survival', 76], ['Team Sports', 77], ['Time Travel', 78],
  ['Urban Fantasy', 82], ['Vampire', 32], ['Video Game', 79], ['Villainess', 83], ['Visual Arts', 80],
  ['Workplace', 48], ['Josei', 43], ['Kids', 15], ['Seinen', 42], ['Shoujo', 25], ['Shounen', 27],
];
const GENRE_IDS = Object.fromEntries(GENRES);
// Fan-service-heavy themes. Their shows stay out of browsing (home, lists, schedule, random, genre
// chips) but still appear when someone searches by title or picks one of these genres directly.
export const BROWSE_HIDDEN = ['Harem', 'Reverse Harem', 'Magical Sex Shift'];
export const isBrowseHidden = anime => [...(anime?.genres || []), ...(anime?.themes || [])].some(name => BROWSE_HIDDEN.includes(name));
const browsable = list => list.filter(anime => !isBrowseHidden(anime));
// Older links used "Thriller"; MAL calls that genre Suspense.
GENRE_IDS.Thriller = 41;

const TYPES = ['tv', 'movie', 'ova', 'ona', 'special', 'music'];
const STATUSES = ['airing', 'complete', 'upcoming'];
const RATINGS = ['g', 'pg', 'pg13', 'r17'];
const ORDERS = {
  popular: ['members', 'desc'],
  score: ['score', 'desc'],
  newest: ['start_date', 'desc'],
  oldest: ['start_date', 'asc'],
  title: ['title', 'asc'],
};
const SEASONS = { winter: [1, 4], spring: [4, 7], summer: [7, 10], fall: [10, 13] };
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'unknown', 'other'];

// Tenrai allows about 4 requests a second, so space calls out within this isolate.
export const throttle = { gapMs: 300 };
let nextSlot = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function takeSlot() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + throttle.gapMs;
  if (start > now) await sleep(start - now);
}

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
  // "TV Special" becomes TV_SPECIAL, matching the other format keys.
  const key = String(value || '').trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z_]/g, '');
  return key || null;
}
function normalizeRelated(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap(group => (Array.isArray(group?.entry) ? group.entry : []).map(entry => {
    const id = first(entry?.mal_id, entry?.id);
    if (id == null) return null;
    // Relations can point at manga; only anime entries can be opened here.
    if (entry?.type && entry.type !== 'anime') return null;
    return {
      id: String(id),
      relation: text(group?.relation) || null,
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
  const names = list => (Array.isArray(list) ? list.map(item => text(item?.name)).filter(Boolean) : []);
  const genres = names(anime.genres);
  const themes = [...names(anime.themes), ...names(anime.demographics)];
  const trailer = text(anime.trailer?.youtube_id);
  const image = imageOf(anime);
  return {
    id: id == null ? null : String(id),
    malId: id == null ? null : Number(id),
    title,
    titleRomaji: text(anime.title) || null,
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
    themes,
    nextAiring: null,
    description: String(anime.synopsis || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
    studios,
    studioLinks: Array.isArray(anime.studios) ? anime.studios.filter(st => st?.mal_id && text(st?.name)).map(st => ({ id: String(st.mal_id), name: text(st.name) })) : [],
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
    broadcast: anime.broadcast?.day && anime.broadcast?.time
      ? { day: text(anime.broadcast.day), time: text(anime.broadcast.time), timezone: text(anime.broadcast.timezone) || 'Asia/Tokyo' }
      : null,
  };
}
// A small card for lists that only carry an ID, title and image (recommendations).
function miniAnime(entry) {
  const id = first(entry?.mal_id, entry?.id);
  if (id == null) return null;
  return { ...normalizeAnime({ mal_id: id, title: entry.title, images: entry.images }), format: null, status: null };
}

export async function request(path, retried = false) {
  await takeSlot();
  const response = await fetch(API + path, { headers: { Accept: 'application/json' } });
  if (response.status === 429 && !retried) {
    await sleep(1200);
    return request(path, true);
  }
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
  return { results: browsable(listData(payload).map(normalizeAnime).filter(anime => anime.id)), pagination: pageInfo(payload, 1) };
}

// Keeps only known filter values, so nothing unexpected reaches Tenrai.
export function cleanFilters(input = {}) {
  const pick = (value, allowed) => (allowed.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : '');
  const genreNames = (Array.isArray(input.genres) ? input.genres : String(input.genres || input.genre || '').split(','))
    .map(name => String(name).trim()).filter(name => GENRE_IDS[name]);
  const year = Number(input.year);
  const score = Number(input.score);
  return {
    query: String(input.query || '').trim().slice(0, 100),
    page: Math.min(200, Math.max(1, Number(input.page) || 1)),
    type: pick(input.type, TYPES),
    status: pick(input.status, STATUSES),
    rating: pick(input.rating, RATINGS),
    season: pick(input.season, Object.keys(SEASONS)),
    year: Number.isInteger(year) && year >= 1917 && year <= 2100 ? year : null,
    score: [5, 6, 7, 8, 9].includes(score) ? score : null,
    genres: [...new Set(genreNames)].slice(0, 5),
    order: ORDERS[input.order] ? input.order : '',
    letter: /^[a-z]$/i.test(String(input.letter || '')) ? String(input.letter).toUpperCase() : '',
    studio: /^\d{1,9}$/.test(String(input.studio || '')) ? String(input.studio) : '',
  };
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}
// Smallest edit distance between the query and any same-length stretch of a title.
function closeness(query, titles) {
  const q = query.toLowerCase();
  let best = Infinity;
  for (const raw of titles) {
    const title = String(raw || '').toLowerCase();
    if (!title) continue;
    if (title.length <= q.length) { best = Math.min(best, levenshtein(q, title)); continue; }
    for (let i = 0; i + q.length <= title.length; i++) best = Math.min(best, levenshtein(q, title.slice(i, i + q.length)));
  }
  return best;
}

const titlesOf = anime => [anime.title, anime.titleRomaji, ...(anime.synonyms || [])];
// True when some title of the anime contains the query as typed (ignoring case and punctuation).
const squash = value => String(value || '').toLowerCase().replace(/[^p{L}p{N}]+/gu, ' ').trim();
function containsQuery(anime, query) {
  const q = squash(query);
  return Boolean(q) && titlesOf(anime).some(title => squash(title).includes(q));
}

// Tenrai matches titles by word prefix, so a typo after the first letters ("frerien") finds
// nothing useful. Close matches come from the most popular titles for short prefixes of the
// query's first two words, ranked by edit distance to the query.
async function closeMatches(query, extra = []) {
  const words = query.toLowerCase().split(/s+/).filter(word => word.length >= 2);
  const prefixes = [...new Set(words.slice(0, 2).map(word => word.slice(0, 2)))];
  const pool = new Map(extra.map(anime => [anime.id, anime]));
  for (const prefix of prefixes) {
    const params = new URLSearchParams({ q: prefix, limit: '25', order_by: 'members', sort: 'desc', 'sfw-strict': 'true' });
    const payload = await request('/anime?' + params.toString()).catch(() => null);
    for (const anime of listData(payload).map(normalizeAnime)) if (anime.id && !pool.has(anime.id)) pool.set(anime.id, anime);
  }
  const limit = Math.max(2, Math.ceil(query.length * 0.45));
  return [...pool.values()]
    .map(anime => ({ anime, distance: closeness(query, titlesOf(anime)) }))
    .filter(item => item.distance <= limit)
    .sort((a, b) => a.distance - b.distance || (b.anime.popularity || 0) - (a.anime.popularity || 0))
    .slice(0, 12)
    .map(item => item.anime);
}

// Year and season browsing uses Tenrai's seasonal lists, which are ranked by popularity.
// A whole year takes the top 25 of each season; a single season takes up to 75 titles.
async function seasonalBrowse(filters) {
  const seasons = filters.season ? [filters.season] : Object.keys(SEASONS);
  const pages = filters.season ? 3 : 1;
  const seen = new Set();
  let all = [];
  for (const season of seasons) {
    for (let page = 1; page <= pages; page++) {
      const params = new URLSearchParams({ limit: '25', page: String(page), 'sfw-strict': 'true' });
      if (filters.type) params.set('filter', filters.type);
      const payload = await request(`/seasons/${filters.year}/${season}?` + params.toString()).catch(() => null);
      for (const anime of listData(payload).map(normalizeAnime)) {
        if (anime.id && !seen.has(anime.id)) { seen.add(anime.id); all.push(anime); }
      }
      if (!payload?.pagination?.has_next_page) break;
    }
  }
  const genreIds = filters.genres;
  all = all.filter(anime =>
    (!filters.query || [anime.title, anime.titleRomaji, ...anime.synonyms].some(t => String(t || '').toLowerCase().includes(filters.query.toLowerCase()))) &&
    (!filters.status || anime.status === { airing: 'RELEASING', complete: 'FINISHED', upcoming: 'NOT_YET_RELEASED' }[filters.status]) &&
    (!filters.score || (anime.score || 0) >= filters.score * 10) &&
    (!filters.rating || ratingKey(anime.rating) === filters.rating) &&
    genreIds.every(name => anime.genres.includes(name) || anime.themes?.includes(name)));
  const order = filters.order || 'popular';
  const by = {
    popular: (a, b) => (b.popularity || 0) - (a.popularity || 0),
    score: (a, b) => (b.score || 0) - (a.score || 0),
    newest: (a, b) => dateKey(b.startDate || {}).localeCompare(dateKey(a.startDate || {})),
    oldest: (a, b) => dateKey(a.startDate || {}).localeCompare(dateKey(b.startDate || {})),
    title: (a, b) => a.title.localeCompare(b.title),
  }[order];
  all.sort(by);
  return { results: all, pageInfo: { currentPage: 1, lastPage: 1, hasNextPage: false, total: all.length }, approximate: false, seasonal: true };
}
function ratingKey(rating) {
  const r = String(rating || '').toLowerCase();
  if (r.startsWith('g ')) return 'g';
  if (r.startsWith('pg-13')) return 'pg13';
  if (r.startsWith('pg')) return 'pg';
  if (r.startsWith('r -') || r.startsWith('r - 17')) return 'r17';
  return '';
}

export async function searchAnime(input = {}) {
  const filters = cleanFilters(input);
  const result = await searchCatalogue(filters);
  // Browsing (no title typed) leaves out the hidden themes unless one was picked on purpose.
  const browsing = !filters.query && !filters.genres.some(name => BROWSE_HIDDEN.includes(name));
  return browsing ? { ...result, results: browsable(result.results) } : result;
}
async function searchCatalogue(filters) {
  const { query, page } = filters;
  if (filters.year) return seasonalBrowse(filters);
  const params = new URLSearchParams({ limit: '24', page: String(page), 'sfw-strict': 'true' });
  if (query) params.set('q', query);
  if (filters.type) params.set('type', filters.type);
  if (filters.status) params.set('status', filters.status);
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.score) params.set('min_score', String(filters.score));
  if (filters.genres.length) params.set('genres', filters.genres.map(name => GENRE_IDS[name]).join(','));
  if (filters.letter) params.set('letter', filters.letter);
  if (filters.studio) params.set('producers', filters.studio);
  if (filters.letter && !filters.order) {
    params.set('order_by', 'title');
    params.set('sort', 'asc');
  } else if (filters.order) {
    params.set('order_by', ORDERS[filters.order][0]);
    params.set('sort', ORDERS[filters.order][1]);
  } else if (!query) {
    params.set('order_by', 'members');
    params.set('sort', 'desc');
  }
  const payload = await request('/anime?' + params.toString());
  let results = listData(payload).map(normalizeAnime).filter(anime => anime.id);
  const info = pageInfo(payload, page);
  let approximate = false;
  const filtered = filters.type || filters.status || filters.rating || filters.score || filters.genres.length || filters.letter || filters.studio;
  // No result contains the query as typed: it is probably misspelled, so put close matches first.
  if (query.length >= 4 && page === 1 && !filtered && !results.some(anime => containsQuery(anime, query))) {
    const close = await closeMatches(query, results);
    if (close.length) {
      const ids = new Set(close.map(anime => anime.id));
      approximate = !results.length || results[0].id !== close[0].id;
      results = [...close, ...results.filter(anime => !ids.has(anime.id))];
      if (!info.hasNextPage) Object.assign(info, { currentPage: 1, lastPage: 1, total: results.length });
    }
  }
  return { results, pageInfo: info, approximate, seasonal: false };
}
const dateKey = d => `${d.year}-${String(d.month || 1).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`;

// Ready-made lists for the home page and type shortcuts.
const LISTS = {
  airing: '/top/anime?filter=airing',
  popular: '/top/anime?filter=bypopularity',
  favorite: '/top/anime?filter=favorite',
  upcoming: '/seasons/upcoming?',
  season: '/seasons/now?',
  completed: '/anime?status=complete&order_by=end_date&sort=desc&min_score=6',
};
export const LIST_NAMES = Object.keys(LISTS);
export async function getList(name, limit = 24) {
  if (!LISTS[name]) throw fail(404, 'Unknown list');
  const size = Math.min(25, Math.max(1, Number(limit) || 24));
  const base = LISTS[name];
  const payload = await request(base + (base.endsWith('?') ? '' : '&') + 'limit=' + size + '&sfw-strict=true');
  return { name, results: browsable(listData(payload).map(normalizeAnime).filter(anime => anime.id)) };
}

export async function getSchedule(rawDay) {
  const day = String(rawDay || '').toLowerCase();
  if (!DAYS.includes(day)) throw fail(400, 'Invalid day');
  const seen = new Set();
  const results = [];
  for (let page = 1; page <= 3; page++) {
    const payload = await request('/schedules?filter=' + day + '&limit=25&page=' + page + '&sfw-strict=true');
    for (const anime of listData(payload).map(normalizeAnime)) {
      if (anime.id && !seen.has(anime.id)) { seen.add(anime.id); results.push(anime); }
    }
    if (!payload?.pagination?.has_next_page) break;
  }
  return { day, results: browsable(results) };
}

export async function getRandom() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = await request('/random/anime?sfw-strict=true');
    const anime = normalizeAnime(payload?.data || payload);
    const rating = anime.rating.toLowerCase();
    if (anime.id && !rating.includes('r+') && !rating.includes('rx') && !isBrowseHidden(anime)) return { id: anime.id, title: anime.title };
  }
  throw fail(502, 'Could not pick a random title. Try again.');
}

// Every season, movie and side story in the franchise, in release (watching) order.
// Follows prequel/sequel/side-story links outward from the given title. Spin-offs and recaps
// are added too, but their own links are not followed, so other series don't get pulled in.
// The main chain is collected first, so the cap never pushes out a real season.
const FOLLOW = new Set(['Prequel', 'Sequel', 'Side Story', 'Parent Story', 'Full Story']);
const LEAF = new Set(['Spin-Off', 'Summary']);
const CHAIN_FORMATS = new Set(['TV', 'TV_SPECIAL', 'MOVIE', 'ONA', 'OVA', 'SPECIAL']);
const MAX_SEASONS = 20;
export async function getSeasons(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const found = new Map();
  const queue = [id];
  const leaves = [];
  const queued = new Set(queue);
  const fetchPart = async (partId) => {
    try {
      const anime = await getAnime(partId);
      return partId === id || CHAIN_FORMATS.has(anime.format) ? anime : null;
    } catch { return null; }
  };
  while (queue.length && found.size < MAX_SEASONS) {
    const next = queue.shift();
    const anime = await fetchPart(next);
    if (!anime) continue;
    found.set(next, anime);
    for (const rel of anime.relations) {
      if (queued.has(rel.id)) continue;
      if (FOLLOW.has(rel.relation)) { queued.add(rel.id); queue.push(rel.id); }
      else if (LEAF.has(rel.relation)) { queued.add(rel.id); leaves.push(rel.id); }
    }
  }
  for (const leaf of leaves) {
    if (found.size >= MAX_SEASONS) break;
    const anime = await fetchPart(leaf);
    if (anime) found.set(leaf, anime);
  }
  const order = a => (a.startDate ? dateKey(a.startDate) : '9999');
  const seasons = [...found.values()].sort((a, b) => order(a).localeCompare(order(b))).map(a => ({
    id: a.id, title: a.title, titleRomaji: a.titleRomaji, format: a.format, year: a.year, cover: a.cover, status: a.status,
    episodes: a.episodes, relation: a.id === id ? null : (found.get(id)?.relations.find(r => r.id === a.id)?.relation || null),
  }));
  return { id, seasons };
}

export async function getExtras(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const [characters, recommendations] = await Promise.all([
    request('/anime/' + id + '/characters').catch(() => null),
    request('/anime/' + id + '/recommendations').catch(() => null),
  ]);
  const people = listData(characters)
    .sort((a, b) => (a.role === 'Main' ? 0 : 1) - (b.role === 'Main' ? 0 : 1) || number(b.favorites) - number(a.favorites))
    .slice(0, 12)
    .map(row => {
      const va = (row.voice_actors || []).find(v => v.language === 'Japanese') || null;
      return {
        name: text(row.character?.name),
        role: text(row.role),
        image: first(row.character?.images?.webp?.image_url, row.character?.images?.jpg?.image_url, null),
        va: va ? { name: text(va.person?.name), image: first(va.person?.images?.jpg?.image_url, null) } : null,
      };
    })
    .filter(person => person.name);
  const recs = listData(recommendations).slice(0, 12).map(row => miniAnime(row.entry)).filter(Boolean);
  return { characters: people, recommendations: recs };
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
    if (rating.includes('r+') || rating.includes('rx') || rating.includes('hentai') || rating.includes('erotica') || anime.genres.some(genre => ['ecchi', 'hentai', 'erotica'].includes(genre.toLowerCase()))) {
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

// Airing shows (One Piece, Detective Conan…) have no episode total on MAL, so count the aired
// episodes from the episode list instead: its first page gives the page count, the last page the rest.
// Only the show's own page asks for this; lists and playback checks don't pay for the extra calls.
export async function getAnimeWithCount(rawId) {
  const anime = await getAnime(rawId);
  if (anime.availableEpisodes > 0 || anime.status !== 'RELEASING') return anime;
  try {
    const pageUrl = page => '/anime/' + encodeURIComponent(anime.id) + '/episodes?page=' + page + '&sfw-strict=true';
    const firstPage = await request(pageUrl(1));
    const perPage = listData(firstPage).length;
    const last = Math.min(MAX_EPISODE_PAGES, number(firstPage?.pagination?.last_visible_page) || 1);
    const aired = last > 1 ? (last - 1) * perPage + listData(await request(pageUrl(last))).length : perPage;
    return aired > 0 ? { ...anime, availableEpisodes: Math.min(aired, 2000) } : anime;
  } catch {
    return anime;
  }
}

const MAX_EPISODE_PAGES = 20;
const episodeCache = new Map();
export async function getEpisodes(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{1,12}$/.test(id)) throw fail(400, 'Invalid MAL anime ID');
  const cached = episodeCache.get(id);
  if (cached && cached.expires > Date.now()) return cached.value;
  const pending = (async () => {
    const pageUrl = page => '/anime/' + encodeURIComponent(id) + '/episodes?page=' + page + '&sfw-strict=true';
    const [anime, payload] = await Promise.all([getAnime(id), request(pageUrl(1)).catch(() => null)]);
    // Tenrai returns 100 episodes per page; fetch the rest so long shows keep their names and filler flags.
    const rows = [...listData(payload)];
    const lastPage = Math.min(MAX_EPISODE_PAGES, number(payload?.pagination?.last_visible_page) || 1);
    for (let page = 2; page <= lastPage; page++) {
      rows.push(...listData(await request(pageUrl(page)).catch(() => null)));
    }
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
