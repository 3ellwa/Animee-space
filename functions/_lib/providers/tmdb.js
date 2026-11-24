// cinemee's catalogue: movies and TV from TMDB (api.themoviedb.org), returned in the same shape
// as animee's anime catalogue (tenrai.js), so the same pages, lists, progress and sync work.
//
// IDs: one number per title, so every existing check (/^\d+$/), URL and database column keeps
// working: a movie is TMDB id × 10 + 1, a TV show TMDB id × 10 + 2 (e.g. movie 550 → 5501).
// TV episodes are numbered straight through all seasons (1, 2, 3 …); each one also carries its
// season and episode number, and the player turns the number back into S/E for the stream.
//
// Needs the TMDB_TOKEN secret (TMDB's "API Read Access Token"); call useToken(env) per request.

import * as tvmaze from './tvmaze.js';
import * as omdb from './omdb.js';
import { containsQuery, prefixesOf, rankClose } from '../fuzzy.js';

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';
const fail = (status, message) => Object.assign(new Error(message), { status });
let token = '';
let omdbKey = '';
export function useToken(env) { token = String(env?.TMDB_TOKEN || ''); omdbKey = String(env?.OMDB_KEY || ''); }

// ---------- ids ----------
export const TYPE_DIGIT = { movie: 1, tv: 2 };
export function encodeId(type, tmdbId) { return String(Number(tmdbId) * 10 + TYPE_DIGIT[type]); }
export function decodeId(rawId) {
  const id = String(rawId || '').trim();
  if (!/^\d{2,12}$/.test(id)) throw fail(400, 'Invalid title ID');
  const digit = Number(id.slice(-1));
  const type = digit === 1 ? 'movie' : digit === 2 ? 'tv' : null;
  if (!type) throw fail(404, 'Title not found');
  return { type, tmdb: id.slice(0, -1) };
}

// ---------- genres ----------
// [shown name, movie genre id, TV genre id]. TMDB uses different ids (and sometimes combined
// names) for TV, so one shown genre maps to the closest one on each side.
const GENRE_TABLE = [
  ['Action', 28, 10759], ['Adventure', 12, 10759], ['Animation', 16, 16], ['Comedy', 35, 35],
  ['Crime', 80, 80], ['Documentary', 99, 99], ['Drama', 18, 18], ['Family', 10751, 10751],
  ['Fantasy', 14, 10765], ['History', 36, null], ['Horror', 27, null], ['Kids', null, 10762],
  ['Music', 10402, null], ['Mystery', 9648, 9648], ['Reality', null, 10764], ['Romance', 10749, null],
  ['Science Fiction', 878, 10765], ['Thriller', 53, null], ['War', 10752, 10768], ['Western', 37, 37],
];
export const GENRES = GENRE_TABLE.map(([name]) => [name]);
export const BROWSE_HIDDEN = [];
const GENRE_NAME = new Map();
for (const [name, movie, tv] of GENRE_TABLE) {
  if (movie && !GENRE_NAME.has('m' + movie)) GENRE_NAME.set('m' + movie, name);
  if (tv && !GENRE_NAME.has('t' + tv)) GENRE_NAME.set('t' + tv, name);
}
// TMDB's own TV names for the combined genres, shown on detail pages.
const TV_GENRE_LABEL = { 10759: 'Action & Adventure', 10765: 'Sci-Fi & Fantasy', 10768: 'War & Politics' };

// ---------- requests ----------
async function request(path, params = {}) {
  if (!token) throw fail(503, 'The movie catalogue is not set up yet (TMDB_TOKEN is missing).');
  const url = new URL(API + path);
  url.searchParams.set('language', 'en-US');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw fail(error?.name === 'TimeoutError' ? 504 : 502, 'The movie catalogue did not respond. Try again shortly.');
  }
  if (response.status === 404) throw fail(404, 'Title not found');
  if (response.status === 429) throw fail(503, 'The movie catalogue is busy. Try again in a moment.');
  if (!response.ok) throw fail(502, 'The movie catalogue had a problem. Try again shortly.');
  return response.json();
}

// ---------- normalizing ----------
const img = (path, size) => (path ? IMG + size + path : null);
const year = (d) => (d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);
const dateParts = (d) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) } : null);
const today = () => new Date().toISOString().slice(0, 10);

function statusOf(type, raw, date) {
  const s = String(raw || '').toLowerCase();
  if (type === 'movie') return s === 'released' || (!s && date && date <= today()) ? 'FINISHED' : 'NOT_YET_RELEASED';
  if (s === 'returning series' || s === 'in production') return date && date <= today() ? 'RELEASING' : 'NOT_YET_RELEASED';
  if (s === 'ended' || s === 'canceled') return 'FINISHED';
  if (s === 'planned' || s === 'pilot') return 'NOT_YET_RELEASED';
  return date && date <= today() ? 'FINISHED' : 'NOT_YET_RELEASED';
}

// Episodes that have aired: every regular season before the latest aired one, plus the
// latest aired episode's number in its season.
function airedCount(show) {
  const last = show.last_episode_to_air;
  if (!last) return 0;
  const seasons = (show.seasons || []).filter((s) => s.season_number > 0);
  return seasons.filter((s) => s.season_number < last.season_number).reduce((n, s) => n + (s.episode_count || 0), 0) + (last.episode_number || 0);
}

/** One list or detail result from TMDB as an animee-shaped title. */
export function normalize(raw, typeHint) {
  if (!raw) return null;
  const type = raw.media_type === 'movie' || raw.media_type === 'tv' ? raw.media_type : typeHint;
  if (type !== 'movie' && type !== 'tv' || !raw.id || raw.adult) return null;
  const movie = type === 'movie';
  const date = movie ? raw.release_date : raw.first_air_date;
  const title = movie ? raw.title : raw.name;
  const original = movie ? raw.original_title : raw.original_name;
  const genres = Array.isArray(raw.genres)
    ? raw.genres.map((g) => (movie ? g.name : TV_GENRE_LABEL[g.id] || g.name))
    : (raw.genre_ids || []).map((gid) => GENRE_NAME.get((movie ? 'm' : 't') + gid)).filter(Boolean);
  const status = statusOf(type, raw.status, date);
  const episodes = movie ? 1 : Number(raw.number_of_episodes) || null;
  const aired = movie ? (status === 'FINISHED' ? 1 : 0) : raw.last_episode_to_air ? airedCount(raw) : 0;
  const runtime = movie ? raw.runtime : (raw.episode_run_time || [])[0] || raw.last_episode_to_air?.runtime;
  const trailer = (raw.videos?.results || []).find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.official !== false)
    || (raw.videos?.results || []).find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const providers = raw['watch/providers']?.results?.US;
  const streamingLinks = providers?.link
    ? [...new Map([...(providers.flatrate || []), ...(providers.free || []), ...(providers.ads || [])].map((p) => [p.provider_name, { site: p.provider_name, url: providers.link }])).values()].slice(0, 10)
    : [];
  const companies = movie ? raw.production_companies : raw.networks;
  const cert = movie
    ? (raw.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US')?.release_dates?.find((d) => d.certification)?.certification
    : (raw.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US')?.rating;
  const next = !movie && raw.next_episode_to_air;
  return {
    id: encodeId(type, raw.id),
    tmdbId: raw.id,
    mediaType: type,
    title: title || 'Untitled',
    titleRomaji: original && original !== title ? original : null,
    titleNative: null,
    cover: img(raw.poster_path, 'w500'),
    banner: img(raw.backdrop_path, 'w1280') || img(raw.poster_path, 'w780'),
    color: null,
    format: movie ? 'MOVIE' : 'TV',
    status,
    episodes,
    availableEpisodes: aired,
    seasonCount: movie ? null : Number(raw.number_of_seasons) || null,
    duration: Number(runtime) || null,
    score: raw.vote_average ? Math.round(raw.vote_average * 10) : null,
    popularity: Number(raw.vote_count) || null,
    season: null,
    year: year(date),
    genres,
    themes: [],
    nextAiring: next ? { airDate: next.air_date, season: next.season_number, episode: next.episode_number } : null,
    description: String(raw.overview || '').trim(),
    studios: (companies || []).slice(0, 3).map((c) => c.name).filter(Boolean),
    studioLinks: [],
    characters: [],
    relations: raw.belongs_to_collection ? [{ id: 'c' + raw.belongs_to_collection.id, relation: 'Collection', title: raw.belongs_to_collection.name }] : [],
    recommendations: [],
    streamingLinks,
    source: null,
    synonyms: [],
    trailer: trailer?.key || null,
    startDate: dateParts(date),
    endDate: movie ? null : dateParts(raw.last_air_date),
    rating: cert || '',
    broadcast: null,
    collectionId: raw.belongs_to_collection?.id || null,
  };
}
const list = (payload, type) => (payload?.results || []).map((r) => normalize(r, type)).filter(Boolean);
const pageInfo = (payload, page) => {
  const lastPage = Math.min(500, Number(payload?.total_pages) || page);
  return { currentPage: page, lastPage, hasNextPage: page < lastPage, total: Number(payload?.total_results) || null };
};

// ---------- details ----------
const detailCache = new Map();
const DETAIL_MS = 10 * 60 * 1000;
async function details(rawId) {
  const { type, tmdb } = decodeId(rawId);
  const key = type + tmdb;
  const hit = detailCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const append = type === 'movie'
    ? 'videos,credits,recommendations,watch/providers,release_dates'
    : 'videos,credits,recommendations,watch/providers,content_ratings,external_ids';
  const pending = request(`/${type}/${tmdb}`, { append_to_response: append }).then((raw) => ({ raw, type }));
  detailCache.set(key, { value: pending, expires: Date.now() + DETAIL_MS });
  if (detailCache.size > 500) detailCache.delete(detailCache.keys().next().value);
  try { return await pending; } catch (error) { detailCache.delete(key); throw error; }
}

export async function getAnime(rawId) {
  const { raw, type } = await details(rawId);
  const title = normalize(raw, type);
  if (!title) throw fail(404, 'Title not found');
  if (type === 'tv' && stillAiring(raw)) applyAirtimes(title, raw, await tvmaze.airtimes(raw));
  return title;
}

// ---------- real air times (TVmaze) ----------
const stillAiring = (raw) => Boolean(raw.next_episode_to_air) || ['Returning Series', 'In Production', 'Planned'].includes(raw.status);
const sameEpisode = (t, e) => Boolean(t && e) && t.season === Number(e.season_number ?? e.season) && t.episode === Number(e.episode_number ?? e.episode);
/** The next episode's exact time, from TVmaze; still null when it isn't due (that's for sure). */
function upcoming(times, now = Date.now()) { return times?.next && times.next.at > now ? times.next : null; }
/**
 * TMDB treats an episode as out from the start of its air date (and in its own time zone);
 * TVmaze knows the hour. An episode later today isn't counted as out yet, and the next
 * episode gets its exact time (`nextAiring.airingAt`, ms).
 */
export function applyAirtimes(title, raw, times, now = Date.now()) {
  const next = upcoming(times, now);
  if (!next) return title;
  if (sameEpisode(next, raw.last_episode_to_air) && title.availableEpisodes > 0) title.availableEpisodes -= 1;
  title.nextAiring = {
    airDate: new Date(next.at).toISOString().slice(0, 10),
    season: next.season, episode: next.episode, airingAt: next.at,
  };
  return title;
}
export const getAnimeWithCount = getAnime; // TMDB already says how many episodes have aired

export async function getExtras(rawId) {
  const { raw, type } = await details(rawId);
  // Cast: the actor's photo and name, with the character they play underneath.
  const characters = (raw.credits?.cast || []).slice(0, 12).map((c) => ({
    name: c.name, role: c.character || '', image: img(c.profile_path, 'w185'), va: null,
  })).filter((c) => c.name);
  const recommendations = list(raw.recommendations, type).slice(0, 12);
  // Scores from OMDb when OMDB_KEY is set; the IMDb link either way.
  const imdbId = type === 'movie' ? raw.imdb_id : raw.external_ids?.imdb_id;
  const scores = imdbId ? await omdb.ratings(imdbId, omdbKey) : null;
  const ratings = imdbId ? { imdbUrl: `https://www.imdb.com/title/${imdbId}/`, ...(scores || {}) } : null;
  return { characters, recommendations, ratings };
}

// A TV show's seasons, each with the straight-through number of its first episode (`startEp`)
// so the page can link straight to it. Seasons that haven't started have no startEp.
export function tvSeasons(id, raw) {
  const day = today();
  let start = 1;
  return (raw.seasons || []).filter((s) => s.season_number > 0).sort((a, b) => a.season_number - b.season_number).slice(0, MAX_SEASONS).map((s) => {
    const started = Boolean(s.air_date && s.air_date <= day && s.episode_count > 0);
    const season = {
      id, season: s.season_number, title: s.name || `Season ${s.season_number}`, titleRomaji: null, format: 'TV',
      year: year(s.air_date), cover: img(s.poster_path, 'w185') || img(raw.poster_path, 'w185'),
      episodes: s.episode_count || 0, airDate: s.air_date || null, startEp: started ? start : null,
    };
    if (started) start += s.episode_count || 0;
    return season;
  });
}

// Movie collections (e.g. every film in a series) take the place of anime "seasons".
export async function getSeasons(rawId) {
  const id = String(rawId);
  const { raw, type } = await details(id);
  if (type === 'tv') return { id, seasons: tvSeasons(id, raw) };
  if (!raw.belongs_to_collection) return { id, seasons: [] };
  const collection = await request(`/collection/${raw.belongs_to_collection.id}`).catch(() => null);
  const parts = (collection?.parts || []).map((p) => normalize(p, 'movie')).filter(Boolean)
    .sort((a, b) => String(a.startDate ? `${a.startDate.year}-${a.startDate.month}` : '9999').localeCompare(String(b.startDate ? `${b.startDate.year}-${b.startDate.month}` : '9999'), undefined, { numeric: true }));
  return {
    id,
    seasons: parts.map((p) => ({ id: p.id, title: p.title, titleRomaji: null, format: 'MOVIE', year: p.year, cover: p.cover, status: p.status, episodes: 1, relation: p.id === id ? null : 'Collection' })),
  };
}

// ---------- episodes ----------
const episodeCache = new Map();
const MAX_SEASONS = 40;
export async function getEpisodes(rawId) {
  const id = String(rawId);
  const hit = episodeCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = (async () => {
    const { raw, type } = await details(id);
    if (type === 'movie') {
      const released = statusOf('movie', raw.status, raw.release_date) === 'FINISHED';
      return { animeId: id, total: released ? 1 : 0, episodes: released ? [{ id: `${id}:1`, number: 1, title: raw.title, isFiller: false, isRecap: false }] : [] };
    }
    const seasonNumbers = (raw.seasons || []).map((s) => s.season_number).filter((n) => n > 0).sort((a, b) => a - b).slice(0, MAX_SEASONS);
    const seasons = [];
    for (let i = 0; i < seasonNumbers.length; i += 8) { // a few seasons at a time
      seasons.push(...await Promise.all(seasonNumbers.slice(i, i + 8).map((n) => request(`/tv/${raw.id}/season/${n}`).catch(() => null))));
    }
    const day = today();
    const episodes = [];
    for (const season of seasons) {
      for (const ep of season?.episodes || []) {
        if (!ep.air_date || ep.air_date > day) continue; // only what has aired can play
        if (episodes.length >= 2000) break;
        const number = episodes.length + 1;
        episodes.push({
          id: `${id}:${number}`, number, title: ep.name || `Episode ${ep.episode_number}`,
          season: ep.season_number, episode: ep.episode_number, label: `S${ep.season_number} · E${ep.episode_number}`,
          airDate: ep.air_date, isFiller: false, isRecap: false,
        });
      }
    }
    // An episode dated today that hasn't actually aired yet (TVmaze knows the hour) isn't out.
    let until = Date.now() + 30 * 60 * 1000;
    if (stillAiring(raw)) {
      const next = upcoming(await tvmaze.airtimes(raw));
      if (next && sameEpisode(next, episodes[episodes.length - 1])) {
        episodes.pop();
        until = Math.min(until, next.at + 60e3);
      }
    }
    return { animeId: id, total: episodes.length, episodes, until };
  })();
  episodeCache.set(id, { value: pending, expires: Date.now() + 30 * 60 * 1000 });
  if (episodeCache.size > 300) episodeCache.delete(episodeCache.keys().next().value);
  try {
    const { until, ...value } = await pending;
    episodeCache.set(id, { value, expires: until || Date.now() + 30 * 60 * 1000 });
    return value;
  } catch (error) { episodeCache.delete(id); throw error; }
}

/** Season and episode for the n-th aired episode of a show (movies: always the film). */
export async function episodeTarget(rawId, number) {
  const { type, tmdb } = decodeId(rawId);
  if (type === 'movie') return { type, tmdb };
  const { episodes } = await getEpisodes(rawId);
  const ep = episodes.find((e) => e.number === Number(number));
  if (!ep) throw fail(404, `Episode ${number} isn't out yet.`);
  return { type, tmdb, season: ep.season, episode: ep.episode };
}

// "Does episode N play": everything that has aired does.
export async function getEpisodeAvailability(rawId, rawEpisode) {
  const id = String(rawId);
  const episode = Number(rawEpisode);
  const { availableEpisodes } = await getAnime(id);
  return { id, episode, sub: Number.isInteger(episode) && episode >= 1 && episode <= availableEpisodes, dub: false };
}
export async function getAvailability(rawId) {
  const { availableEpisodes } = await getAnime(rawId);
  return { id: String(rawId), sub: availableEpisodes, dub: 0, checked: new Date().toISOString() };
}

// ---------- lists ----------
// Movies and TV merged by popularity, for pages that show both.
async function both(path, params, page = 1) {
  const [movies, shows] = await Promise.all([
    request(`/${path.replace('{t}', 'movie')}`, { ...params, page }).catch(() => null),
    request(`/${path.replace('{t}', 'tv')}`, { ...params, page }).catch(() => null),
  ]);
  if (!movies && !shows) throw fail(502, 'The movie catalogue had a problem. Try again shortly.');
  const merged = [...list(movies, 'movie'), ...list(shows, 'tv')].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  const lastPage = Math.min(500, Math.max(Number(movies?.total_pages) || 0, Number(shows?.total_pages) || 0) || page);
  return { results: merged, pageInfo: { currentPage: page, lastPage, hasNextPage: page < lastPage, total: (Number(movies?.total_results) || 0) + (Number(shows?.total_results) || 0) || null } };
}

// The home page's "this season" block: what's trending today.
export async function getSeasonalAnime() {
  const payload = await request('/trending/all/day');
  return { results: list(payload).slice(0, 24), pagination: pageInfo(payload, 1) };
}

const LISTS = {
  airing: async () => list(await request('/tv/on_the_air'), 'tv'),                 // TV airing this week
  popular: async () => list(await request('/trending/all/week')),                  // trending this week
  favorite: async () => (await both('{t}/top_rated', {})).results,                 // highest rated
  upcoming: async () => list(await request('/movie/upcoming'), 'movie'),           // coming to cinemas
  season: async () => list(await request('/movie/now_playing'), 'movie'),          // in cinemas now
  completed: async () => list(await request('/discover/tv', { with_status: 3, sort_by: 'popularity.desc', include_adult: false }), 'tv'), // ended series
};
export const LIST_NAMES = Object.keys(LISTS);
export async function getList(name, limit = 24) {
  if (!LISTS[name]) throw fail(404, 'Unknown list');
  const size = Math.min(25, Math.max(1, Number(limit) || 24));
  return { name, results: (await LISTS[name]()).slice(0, size) };
}

// ---------- search and browse ----------
const ORDERS = {
  popular: 'popularity.desc', popularity: 'popularity.desc', score: 'vote_average.desc', newest: '{date}.desc', oldest: '{date}.asc', title: '{title}.asc',
};
export async function searchAnime(input = {}) {
  const query = String(input.query || '').trim().slice(0, 100);
  const page = Math.min(500, Math.max(1, Number(input.page) || 1));
  const type = ['movie', 'tv'].includes(String(input.type || '').toLowerCase()) ? String(input.type).toLowerCase() : '';
  if (query) {
    const payload = await request('/search/multi', { query, page, include_adult: false });
    let results = list(payload).filter((t) => !type || t.mediaType === type);
    const info = pageInfo(payload, page);
    let approximate = false;
    // Nothing contains the query as typed: probably a typo ("intersteller"). Ask for short
    // prefixes of its first words and put the closest titles first.
    const titles = (t) => [t.title, t.titleRomaji].filter(Boolean);
    if (query.length >= 4 && page === 1 && !results.some((t) => containsQuery(titles(t), query))) {
      const pool = new Map(results.map((t) => [t.id, t]));
      // Longer prefixes first (TMDB matches words from their start); at most three extra asks.
      for (const prefix of prefixesOf(query, [6, 4]).slice(0, 3)) {
        const more = await request('/search/multi', { query: prefix, page: 1, include_adult: false }).catch(() => null);
        for (const t of list(more)) if ((!type || t.mediaType === type) && !pool.has(t.id)) pool.set(t.id, t);
      }
      const close = rankClose(query, [...pool.values()], titles).slice(0, 12);
      if (close.length) {
        const ids = new Set(close.map((t) => t.id));
        approximate = !results.length || results[0].id !== close[0].id;
        results = [...close, ...results.filter((t) => !ids.has(t.id))];
        if (!info.hasNextPage) Object.assign(info, { currentPage: 1, lastPage: 1, total: results.length });
      }
    }
    return { results, pageInfo: info, approximate, seasonal: false };
  }
  const names = String(Array.isArray(input.genres) ? input.genres.join(',') : input.genres || '').split(',').map((s) => s.trim()).filter(Boolean);
  const pick = (side) => names.map((n) => GENRE_TABLE.find(([name]) => name === n)?.[side === 'movie' ? 1 : 2]).filter(Boolean);
  const order = ORDERS[input.order] || ORDERS.popularity;
  const yearValue = /^\d{4}$/.test(String(input.year || '')) ? Number(input.year) : null;
  const score = Number(input.score) ? Math.min(10, Number(input.score)) : null;
  // Status shortcuts: "on air now" = TV shows still running; "coming soon" = films not out yet.
  const status = String(input.status || '').toLowerCase();
  const params = (side) => {
    const ids = pick(side);
    // A genre that one side doesn't have rules that side out.
    if (names.length && ids.length < names.length) return null;
    return {
      include_adult: false,
      sort_by: order.replace('{date}', side === 'movie' ? 'primary_release_date' : 'first_air_date').replace('{title}', side === 'movie' ? 'original_title' : 'original_name'),
      with_genres: ids.join(','),
      [side === 'movie' ? 'primary_release_year' : 'first_air_date_year']: yearValue,
      'vote_average.gte': score,
      // Sorting by score or date needs enough votes to mean something.
      'vote_count.gte': input.order === 'score' ? 200 : input.order ? 20 : null,
      [side === 'movie' ? 'primary_release_date.lte' : 'first_air_date.lte']: input.order === 'newest' ? today() : null,
      ...(status === 'airing' && side === 'tv' ? { with_status: '0', 'air_date.gte': today() } : {}),
      ...(status === 'upcoming' && side === 'movie' ? { 'primary_release_date.gte': today() } : {}),
    };
  };
  const sides = status === 'airing' ? ['tv'] : status === 'upcoming' ? ['movie'] : type ? [type] : ['movie', 'tv'];
  const pages = await Promise.all(sides.map((side) => {
    const p = params(side);
    return p ? request(`/discover/${side}`, { ...p, page }).then((payload) => ({ side, payload })).catch(() => null) : null;
  }));
  const usable = pages.filter(Boolean);
  if (!usable.length && names.length) return { results: [], pageInfo: { currentPage: page, lastPage: page, hasNextPage: false, total: 0 }, approximate: false, seasonal: false };
  if (!usable.length) throw fail(502, 'The movie catalogue had a problem. Try again shortly.');
  let results = usable.flatMap(({ side, payload }) => list(payload, side));
  if (usable.length > 1) {
    const key = input.order === 'score' ? 'score' : input.order === 'title' ? 'title' : 'popularity';
    results.sort((a, b) => (key === 'title' ? String(a.title).localeCompare(String(b.title)) : (b[key] || 0) - (a[key] || 0)));
  }
  const lastPage = Math.min(500, Math.max(...usable.map(({ payload }) => Number(payload?.total_pages) || 1)));
  return { results, pageInfo: { currentPage: page, lastPage, hasNextPage: page < lastPage, total: usable.reduce((n, { payload }) => n + (Number(payload?.total_results) || 0), 0) }, approximate: false, seasonal: false };
}

// ---------- schedule ----------
// TV episodes airing on the given weekday, within yesterday … five days ahead (the schedule page's range).
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export async function getSchedule(rawDay) {
  const day = String(rawDay || '').toLowerCase();
  if (!DAYS.includes(day)) throw fail(400, 'Invalid day');
  const date = new Date(Date.now() - 86400e3);
  for (let i = 0; i < 7 && DAYS[date.getUTCDay()] !== day; i++) date.setUTCDate(date.getUTCDate() + 1);
  const iso = date.toISOString().slice(0, 10);
  const pages = await Promise.all([1, 2].map((page) => request('/discover/tv', {
    'air_date.gte': iso, 'air_date.lte': iso, sort_by: 'popularity.desc', include_adult: false, page,
  }).catch(() => null)));
  const seen = new Set();
  const results = pages.flatMap((p) => list(p, 'tv')).filter((t) => !seen.has(t.id) && seen.add(t.id));
  // Exact times from TVmaze's US TV and streaming schedules, matched by title.
  // The countries these shows come from, most common first (TVmaze schedules are per country).
  const counts = new Map();
  for (const p of pages) for (const r of p?.results || []) { const c = r.origin_country?.[0]; if (c) counts.set(c, (counts.get(c) || 0) + 1); }
  const countries = [...counts].sort((x, y) => y[1] - x[1]).map(([c]) => c).slice(0, 6);
  const times = await tvmaze.daySchedule(iso, countries.length ? countries : ['US']);
  for (const t of results) {
    const keys = [t.title, t.titleRomaji].map(tvmaze.titleKey).filter(Boolean);
    const at = keys.map((k) => times.get(k)).find(Boolean);
    if (at) t.airingAt = at;
  }
  return { day, date: iso, results };
}

// ---------- random ----------
export async function getRandom() {
  const type = Math.random() < 0.6 ? 'movie' : 'tv';
  const page = 1 + Math.floor(Math.random() * 20);
  const payload = await request(`/discover/${type}`, { sort_by: 'popularity.desc', 'vote_count.gte': 300, include_adult: false, page });
  const results = list(payload, type);
  if (!results.length) throw fail(502, 'Could not pick a random title. Try again.');
  const pick = results[Math.floor(Math.random() * results.length)];
  return { id: pick.id, title: pick.title };
}

// ---------- playback ----------
// The stream address for one title. Both players address movies and shows by TMDB id:
//   vidsrc:  https://vidsrc.to/embed/movie/{id}   and /embed/tv/{id}/{season}/{episode}
//   vidnest: https://vidnest.fun/movie/{id}       and /tv/{id}/{season}/{episode}
//   vidnext: https://vidnext.pro/movie/{id}       and /tv/{id}/{season}/{episode}
//   embedmaster: https://embedmaster.link/movie/{id} and /tv/{id}/{season}/{episode}
//   vidcore: https://vidcore.org/embed/movie/{id} and /embed/tv/{id}/{season}/{episode}
//   vidfast: https://vidfast.vc/movie/{id}       and /tv/{id}/{season}/{episode} (vidfast.pro redirects here)
//   vidlink: https://vidlink.pro/movie/{id}      and /tv/{id}/{season}/{episode}
const PLAYERS = {
  // VidFast: its final host, so the origin check on its messages matches. theme = cinemee's red.
  vidfast: { base: 'https://vidfast.vc', movie: (t) => `/movie/${t.tmdb}?theme=FF3D52`, tv: (t) => `/tv/${t.tmdb}/${t.season}/${t.episode}?theme=FF3D52` },
  // VidLink: colors are hex without '#'.
  vidlink: { base: 'https://vidlink.pro', movie: (t) => `/movie/${t.tmdb}?primaryColor=FF3D52`, tv: (t) => `/tv/${t.tmdb}/${t.season}/${t.episode}?primaryColor=FF3D52` },
  vidsrc: { base: 'https://vidsrc.to', movie: (t) => `/embed/movie/${t.tmdb}`, tv: (t) => `/embed/tv/${t.tmdb}/${t.season}/${t.episode}` },
  vidnest: { base: 'https://vidnest.fun', movie: (t) => `/movie/${t.tmdb}`, tv: (t) => `/tv/${t.tmdb}/${t.season}/${t.episode}` },
  // vidnext: theme = cinemee's red for its controls.
  vidnext: { base: 'https://vidnext.pro', movie: (t) => `/movie/${t.tmdb}?theme=FF3D52`, tv: (t) => `/tv/${t.tmdb}/${t.season}/${t.episode}?theme=FF3D52` },
  // EmbedMaster: dark skin, no welcome page.
  embedmaster: { base: 'https://embedmaster.link', movie: (t) => `/movie/${t.tmdb}?skin=onyx&welcome_page=off`, tv: (t) => `/tv/${t.tmdb}/${t.season}/${t.episode}?skin=onyx&welcome_page=off` },
  vidcore: { base: 'https://vidcore.org', movie: (t) => `/embed/movie/${t.tmdb}?theme=FF3D52`, tv: (t) => `/embed/tv/${t.tmdb}/${t.season}/${t.episode}?theme=FF3D52` },
};
export async function getSources(rawId, rawEpisode, server = 'vidnest') {
  const player = PLAYERS[server] || PLAYERS.vidnest;
  const target = await episodeTarget(rawId, rawEpisode);
  const embedUrl = player.base + (target.type === 'movie' ? player.movie(target) : player.tv(target));
  return { embedUrl, embedOrigin: player.base, language: 'sub', provider: PLAYERS[server] ? server : 'vidnest', events: [] };
}

/** Test hook: forget cached details and episode lists. */
export function resetCache() { detailCache.clear(); episodeCache.clear(); }
