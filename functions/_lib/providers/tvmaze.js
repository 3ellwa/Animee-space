// Real air times for cinemee's TV shows, from TVmaze (api.tvmaze.com: free, no key; please credit
// "TVmaze" with a link, which the site footer does). TMDB only knows the air *date*, so without
// this an episode looks "out" the whole day before it airs, and the schedule has no times.
//
// Per show: TVmaze's show id is looked up once from the TMDB show's TVDB or IMDb id (kept for a
// week), then the show with its next and previous episode is fetched (kept for an hour).
// TVmaze allows about 20 calls every 10 seconds per address, so everything is cached and every
// failure simply means "no time known" (the old date-only behaviour).

const API = 'https://api.tvmaze.com';
const SHOW_MS = 60 * 60 * 1000;
const ID_MS = 7 * 86400e3;
const MISS_MS = 6 * 60 * 60 * 1000;
const ids = new Map();   // tmdb tv id -> { value: tvmaze id | null, expires }
const shows = new Map(); // tvmaze id -> { value, expires }
const days = new Map();  // date -> { value: Map(title -> airstamp), expires }

export function resetCache() { ids.clear(); shows.clear(); days.clear(); }

async function get(path) {
  const response = await fetch(API + path, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`TVmaze ${response.status}`);
  return response.json();
}
function remember(map, key, value, ms) {
  if (map.size > 1000) map.delete(map.keys().next().value);
  map.set(key, { value, expires: Date.now() + ms });
  return value;
}
const fresh = (map, key) => { const hit = map.get(key); return hit && hit.expires > Date.now() ? hit : null; };

const episode = (ep) => {
  const at = Date.parse(ep?.airstamp || '');
  // No airtime: TVmaze only knows the date, so there's no exact time to use.
  return ep && ep.airtime && Number.isFinite(at) ? { season: Number(ep.season), episode: Number(ep.number), at } : null;
};

async function showId(raw) {
  const hit = fresh(ids, raw.id);
  if (hit) return hit.value;
  const ext = raw.external_ids || {};
  let found = null;
  if (ext.tvdb_id) found = await get(`/lookup/shows?thetvdb=${encodeURIComponent(ext.tvdb_id)}`);
  if (!found && ext.imdb_id) found = await get(`/lookup/shows?imdb=${encodeURIComponent(ext.imdb_id)}`);
  return remember(ids, raw.id, found?.id || null, found ? ID_MS : MISS_MS);
}

/**
 * For a TMDB TV show (details with external_ids): { next, previous } episodes as
 * { season, episode, at (ms) }, or null when TVmaze doesn't know the show or can't be reached.
 */
export async function airtimes(raw) {
  try {
    const id = await showId(raw);
    if (!id) return null;
    const hit = fresh(shows, id);
    if (hit) return hit.value;
    const show = await get(`/shows/${id}?embed[]=nextepisode&embed[]=previousepisode`);
    const value = show ? { next: episode(show._embedded?.nextepisode), previous: episode(show._embedded?.previousepisode) } : null;
    return remember(shows, id, value, SHOW_MS);
  } catch {
    return null;
  }
}

const key = (title) => String(title || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

/** One country's TV schedule for a date ('web' = streaming), kept for an hour. */
async function scheduleFor(date, country) {
  const k = `${date}:${country}`;
  const hit = fresh(days, k);
  if (hit) return hit.value;
  const path = country === 'web' ? `/schedule/web?date=${date}` : `/schedule?country=${country}&date=${date}`;
  const list = await get(path).catch(() => null);
  return list ? remember(days, k, list, SHOW_MS) : [];
}

/**
 * title key -> earliest airstamp (ms) on that date, from TVmaze's streaming schedule and the TV
 * schedules of the given countries (TMDB's origin_country, e.g. ['US', 'KR']; at most 6).
 */
export async function daySchedule(date, countries = ['US']) {
  const out = new Map();
  try {
    const wanted = ['web', ...new Set(countries.filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, 7);
    const lists = await Promise.all(wanted.map((c) => scheduleFor(date, c)));
    for (const ep of lists.flat()) {
      const show = ep.show || ep._embedded?.show;
      const at = Date.parse(ep.airstamp || '');
      // No airtime means TVmaze only knows the date (its airstamp is then a placeholder).
      if (!show?.name || !ep.airtime || !Number.isFinite(at)) continue;
      const k = key(show.name);
      if (!k) continue;
      if (!out.has(k) || out.get(k) > at) out.set(k, at);
    }
  } catch { /* no times for this day */ }
  return out;
}
export const titleKey = key;
