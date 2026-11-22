// mangee's catalogue: manga from MangaDex (api.mangadex.org), returned in the same shape as
// animee's anime catalogue (tenrai.js) and cinemee's (tmdb.js), so the same pages, lists,
// progress and sync work. "Episodes" are chapters; a chapter's "time" is the page you're on.
//
// MangaDex rules (https://api.mangadex.org/docs/): credit MangaDex and the scanlation groups
// (every chapter carries its group names), no ads, requests from our server with a real
// User-Agent and no Via header, images proxied through us (/api/mdimg), and a report to
// api.mangadex.network for each image from a MangaDex@Home node. About 5 requests a second per
// IP: everything here is cached, and the API routes are edge-cached on top.
//
// IDs: MangaDex uses UUIDs; everything else here uses plain numbers. Each series gets a number
// the first time it's seen (table `titles` in mangee's database), kept forever.
// Content: safe and suggestive only (the same family-friendly line as animee).

const API = 'https://api.mangadex.org';
const UA = 'mangee/1.0 (+https://mangee.animee.space)';
const RATINGS = ['safe', 'suggestive'];
const fail = (status, message) => Object.assign(new Error(message), { status });

let db = null;
/** Call once per request with the site's env (mangee's database holds the id numbers). */
export function useEnv(env) { db = env?.DB || null; }

// ---------- requests (cached, gentle) ----------
const responses = new Map(); // url -> { value: Promise, expires }
const RESPONSE_MS = 5 * 60 * 1000;
export function resetCache() { responses.clear(); ids.clear(); uuids.clear(); episodeCache.clear(); readable.clear(); tagIds = null; }

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => q.append(`${k}[]`, x));
    else q.set(k, String(v));
  }
  return q.toString();
}
export async function request(path, params = {}, { ttl = RESPONSE_MS } = {}) {
  const url = `${API}${path}${Object.keys(params).length ? `?${query(params)}` : ''}`;
  const hit = responses.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = (async () => {
    let r;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
      } catch (err) {
        throw fail(err?.name === 'TimeoutError' ? 504 : 502, 'The manga catalogue did not respond. Try again shortly.');
      }
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, 1100)); // over the limit: wait a second, once
    }
    if (r.status === 404) throw fail(404, 'Title not found');
    if (r.status === 429) throw fail(503, 'The manga catalogue is busy. Try again in a moment.');
    if (!r.ok) throw fail(502, 'The manga catalogue had a problem. Try again shortly.');
    return r.json();
  })();
  responses.set(url, { value: pending, expires: Date.now() + ttl });
  if (responses.size > 800) responses.delete(responses.keys().next().value);
  try { return await pending; } catch (err) { responses.delete(url); throw err; }
}

// ---------- ids: MangaDex UUID <-> our number ----------
const ids = new Map();   // uuid -> number
const uuids = new Map(); // number -> uuid
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function ensureTable() {
  await db.prepare('CREATE TABLE IF NOT EXISTS titles (id INTEGER PRIMARY KEY, uuid TEXT NOT NULL UNIQUE)').run();
}
/** Numbers for many UUIDs at once (new ones are added). */
export async function idsFor(list) {
  const want = [...new Set(list.filter((u) => UUID.test(u)))];
  const missing = want.filter((u) => !ids.has(u));
  if (missing.length) {
    if (!db) throw fail(503, 'The manga catalogue is not set up (no database).');
    const run = async () => {
      for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        await db.batch(chunk.map((u) => db.prepare('INSERT OR IGNORE INTO titles (uuid) VALUES (?)').bind(u)));
        const { results } = await db.prepare(`SELECT id, uuid FROM titles WHERE uuid IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
        for (const r of results || []) { ids.set(r.uuid, r.id); uuids.set(r.id, r.uuid); }
      }
    };
    try { await run(); } catch (err) {
      if (!/no such table/i.test(String(err?.message))) throw err;
      await ensureTable();
      await run();
    }
  }
  return want.reduce((m, u) => (ids.has(u) ? m.set(u, ids.get(u)) : m), new Map());
}
/** The MangaDex UUID behind one of our numbers. */
export async function uuidOf(rawId) {
  const id = Number(String(rawId ?? '').trim());
  if (!/^\d{1,12}$/.test(String(rawId ?? '').trim()) || !id) throw fail(400, 'That link doesn’t point to a title.');
  if (uuids.has(id)) return uuids.get(id);
  if (!db) throw fail(503, 'The manga catalogue is not set up (no database).');
  let row = null;
  try { row = await db.prepare('SELECT uuid FROM titles WHERE id = ?').bind(id).first(); } catch { /* no table yet */ }
  if (!row) throw fail(404, 'Title not found');
  uuids.set(id, row.uuid);
  ids.set(row.uuid, id);
  return row.uuid;
}

// ---------- normalizing ----------
const pick = (obj, langs = ['en', 'ja-ro', 'ko-ro', 'zh-ro', 'ja', 'ko', 'zh']) => {
  if (!obj) return null;
  for (const l of langs) if (obj[l]) return obj[l];
  const first = Object.values(obj)[0];
  return first || null;
};
const STATUS = { ongoing: 'RELEASING', completed: 'FINISHED', hiatus: 'HIATUS', cancelled: 'CANCELLED' };
const FORMAT_BY_LANGUAGE = { ko: 'MANHWA', zh: 'MANHUA', 'zh-hk': 'MANHUA' };
/** A cover through our image proxy (MangaDex blocks hotlinking). size: 256 or 512. */
export function coverUrl(uuid, fileName, size = 512) {
  if (!uuid || !fileName) return null;
  return `/api/mdimg?u=${encodeURIComponent(`https://uploads.mangadex.org/covers/${uuid}/${fileName}.${size}.jpg`)}`;
}
function rel(m, type) { return (m.relationships || []).filter((r) => r.type === type); }

/** One MangaDex manga (with cover_art / author / artist included) as an animee-shaped title. */
export function normalize(m, id, stats = null) {
  if (!m?.attributes) return null;
  const a = m.attributes;
  if (!RATINGS.includes(a.contentRating)) return null;
  const altEn = (a.altTitles || []).map((t) => t.en).find(Boolean);
  const main = a.title?.en || altEn || pick(a.title);
  const romaji = pick(a.title, ['ja-ro', 'ko-ro', 'zh-ro']) || (a.altTitles || []).map((t) => t['ja-ro'] || t['ko-ro'] || t['zh-ro']).find(Boolean) || null;
  const native = (a.altTitles || []).map((t) => t.ja || t.ko || t.zh).find(Boolean) || null;
  const cover = rel(m, 'cover_art')[0]?.attributes?.fileName;
  const tags = (a.tags || []).map((t) => ({ name: t.attributes?.name?.en, group: t.attributes?.group })).filter((t) => t.name);
  const people = [...rel(m, 'author'), ...rel(m, 'artist')].map((r) => r.attributes?.name).filter(Boolean);
  const year = Number(a.year) || null;
  const last = Number(a.lastChapter) || null;
  const score = stats?.rating?.bayesian ? Math.round(stats.rating.bayesian * 10) : null;
  const links = a.links || {};
  const official = links.engtl ? (/^https?:/.test(links.engtl) ? links.engtl : null) : null;
  return {
    id: String(id),
    mdId: m.id,
    mediaType: 'manga',
    title: main || 'Untitled',
    titleRomaji: romaji && romaji !== main ? romaji : null,
    titleNative: native,
    cover: coverUrl(m.id, cover, 512),
    banner: coverUrl(m.id, cover, 512),
    color: null,
    format: a.oneshot || tags.some((t) => t.name === 'Oneshot') ? 'ONE_SHOT' : FORMAT_BY_LANGUAGE[a.originalLanguage] || 'MANGA',
    status: STATUS[a.status] || 'FINISHED',
    episodes: a.status === 'completed' && last ? last : null,
    availableEpisodes: null, // filled from the chapter list where it matters (getAnimeWithCount)
    duration: null,
    score,
    popularity: stats?.follows || null,
    season: null,
    year,
    genres: [...new Set(tags.filter((t) => t.group === 'genre' || t.group === 'theme').map((t) => t.name))].slice(0, 10),
    themes: [],
    nextAiring: null,
    description: String(pick(a.description) || '').replace(/\[(?:\/)?[a-z]+[^\]]*\]/gi, '').replace(/\r\n/g, '\n').trim(),
    studios: [...new Set(people)].slice(0, 3),
    studioLinks: [],
    characters: [],
    relations: [],
    recommendations: [],
    streamingLinks: [
      ...(official ? [{ site: 'Official English', url: official }] : []),
      { site: 'MangaDex', url: `https://mangadex.org/title/${m.id}` },
    ],
    officialUrl: official,
    source: null,
    synonyms: (a.altTitles || []).map((t) => t.en).filter(Boolean).slice(0, 5),
    trailer: null,
    startDate: year ? { year, month: null, day: null } : null,
    endDate: null,
    rating: a.contentRating === 'suggestive' ? 'Teen' : 'All ages',
    broadcast: null,
    demographic: a.publicationDemographic || null,
    originalLanguage: a.originalLanguage || null,
    languages: a.availableTranslatedLanguages || [],
  };
}

/** Many MangaDex manga -> titles (numbers assigned, covers proxied). */
async function list(data, statsByUuid = {}) {
  const items = (data || []).filter((m) => RATINGS.includes(m?.attributes?.contentRating));
  const map = await idsFor(items.map((m) => m.id));
  return items.map((m) => normalize(m, map.get(m.id), statsByUuid[m.id])).filter((t) => t && t.id !== 'undefined');
}
async function statsFor(uuidList) {
  if (!uuidList.length) return {};
  try { return (await request('/statistics/manga', { manga: uuidList.slice(0, 100) }, { ttl: 30 * 60 * 1000 })).statistics || {}; } catch { return {}; }
}
const pageInfo = (payload, page, limit) => {
  const total = Math.min(Number(payload?.total) || 0, 10000);
  const lastPage = Math.max(1, Math.ceil(total / limit));
  return { currentPage: page, lastPage, hasNextPage: page < lastPage, total };
};

// ---------- genres (MangaDex tags) ----------
export const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi',
  'Slice of Life', 'Sports', 'Thriller', 'Tragedy', 'Isekai', 'Historical', 'Mecha', 'Medical', 'Philosophical',
  'Superhero', 'Wuxia', 'Magical Girls', 'Crime', 'Martial Arts', 'School Life', 'Supernatural', 'Reincarnation',
  'Time Travel', 'Video Games', 'Cooking', 'Music', 'Military', 'Monsters', 'Survival', 'Villainess', 'Office Workers',
].map((name) => [name]);
export const BROWSE_HIDDEN = [];
let tagIds = null;
async function tagId(name) {
  if (!tagIds) {
    const d = await request('/manga/tag', {}, { ttl: 24 * 3600 * 1000 });
    tagIds = new Map((d.data || []).map((t) => [String(t.attributes?.name?.en || '').toLowerCase(), t.id]));
  }
  return tagIds.get(String(name).toLowerCase()) || null;
}

const BASE = { contentRating: RATINGS, includes: ['cover_art'], hasAvailableChapters: 'true' };

// Home rows only show series you can actually read here. MangaDex's own "has chapters" flags
// count chapters that were removed or only link to the publisher (licensed series), so each
// title is checked for one readable English chapter: five at a time, remembered for 6 hours.
const readable = new Map(); // uuid -> { ok, expires }
async function isReadable(uuid) {
  const hit = readable.get(uuid);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = true;
  try {
    const d = await request(`/manga/${uuid}/feed`, { translatedLanguage: ['en'], contentRating: RATINGS, includeExternalUrl: '0', includeEmptyPages: '0', limit: 1 }, { ttl: 6 * 3600 * 1000 });
    ok = Number(d.total) > 0;
  } catch { /* can't tell right now: keep it */ }
  if (readable.size > 3000) readable.clear();
  readable.set(uuid, { ok, expires: Date.now() + 6 * 3600 * 1000 });
  return ok;
}
async function onlyReadable(data) {
  const out = [];
  const items = data || [];
  for (let i = 0; i < items.length; i += 5) {
    const checks = await Promise.all(items.slice(i, i + 5).map((m) => isReadable(m.id)));
    items.slice(i, i + 5).forEach((m, j) => { if (checks[j]) out.push(m); });
  }
  return out;
}

// ---------- lists for the home page ----------
// The names match animee's home shelves; mangee labels them its own way (app.js).
const LISTS = {
  airing: { 'order[latestUploadedChapter]': 'desc', availableTranslatedLanguage: ['en'] },   // Latest updates
  season: { 'order[createdAt]': 'desc', availableTranslatedLanguage: ['en'] },                // New on mangee
  upcoming: { 'order[rating]': 'desc', status: ['ongoing'] },                                  // Top rated, still going
  completed: { 'order[followedCount]': 'desc', status: ['completed'] },                        // Completed
  popular: { 'order[followedCount]': 'desc' },                                                 // Most followed
  favorite: { 'order[rating]': 'desc' },                                                       // Top rated
};
export const LIST_NAMES = Object.keys(LISTS);
export async function getList(name, limit = 24) {
  const extra = LISTS[name];
  if (!extra) throw fail(404, 'Unknown list');
  const n = Math.min(40, Math.max(1, Number(limit) || 24));
  const d = await request('/manga', { ...BASE, ...extra, limit: n }, { ttl: 15 * 60 * 1000 });
  const data = await onlyReadable(d.data);
  const stats = await statsFor(data.map((m) => m.id));
  return { results: await list(data, stats) };
}
/** Spotlight and "Top 10": the most followed series that are still coming out. */
export async function getSeasonalAnime() {
  const d = await request('/manga', { ...BASE, 'order[followedCount]': 'desc', status: ['ongoing'], availableTranslatedLanguage: ['en'], limit: 24 }, { ttl: 30 * 60 * 1000 });
  const data = (await onlyReadable(d.data)).slice(0, 20);
  const stats = await statsFor(data.map((m) => m.id));
  const results = await list(data, stats);
  return { results, pagination: { has_next_page: false } };
}

// ---------- search ----------
const ORDERS = { popular: ['followedCount', 'desc'], score: ['rating', 'desc'], newest: ['createdAt', 'desc'], oldest: ['createdAt', 'asc'], title: ['title', 'asc'], relevance: ['relevance', 'desc'] };
const ORIGIN = { manga: ['ja'], manhwa: ['ko'], manhua: ['zh', 'zh-hk'] };
export async function searchAnime(input = {}) {
  const page = Math.min(400, Math.max(1, Number(input.page) || 1));
  const limit = 24;
  const query = String(input.query || '').trim().slice(0, 100);
  const names = String(Array.isArray(input.genres) ? input.genres.join(',') : input.genres || '').split(',').map((s) => s.trim()).filter(Boolean);
  const tags = (await Promise.all(names.map(tagId))).filter(Boolean);
  const [field, dir] = ORDERS[input.order] || (query ? ORDERS.relevance : ORDERS.popular);
  const status = { airing: ['ongoing'], complete: ['completed'], upcoming: ['hiatus'] }[String(input.status || '')] || undefined;
  const params = {
    ...BASE,
    title: query || undefined,
    includedTags: tags.length ? tags : undefined,
    status,
    originalLanguage: ORIGIN[String(input.type || '').toLowerCase()],
    year: /^\d{4}$/.test(String(input.year || '')) ? input.year : undefined,
    [`order[${field}]`]: dir,
    limit,
    offset: (page - 1) * limit,
  };
  // A typed search also finds series with no chapters here (shown with a note and the official link).
  if (query) delete params.hasAvailableChapters;
  const d = await request('/manga', params);
  const stats = await statsFor((d.data || []).map((m) => m.id));
  return { results: await list(d.data, stats), pageInfo: pageInfo(d, page, limit), approximate: false, seasonal: false };
}

// ---------- one title ----------
async function details(rawId) {
  const uuid = await uuidOf(rawId);
  const [d, stats] = await Promise.all([
    request(`/manga/${uuid}`, { includes: ['cover_art', 'author', 'artist', 'manga'] }, { ttl: 30 * 60 * 1000 }),
    statsFor([uuid]),
  ]);
  return { raw: d.data, uuid, stats: stats[uuid] || null };
}
export async function getAnime(rawId) {
  const { raw, stats } = await details(rawId);
  const t = normalize(raw, String(rawId), stats);
  if (!t) throw fail(404, 'Title not found');
  return t;
}
/** With the number of chapters readable here (in English), so pages can say "no chapters here". */
export async function getAnimeWithCount(rawId, lang = 'en') {
  const t = await getAnime(rawId);
  try { t.availableEpisodes = (await getEpisodes(rawId, lang)).total; } catch { t.availableEpisodes = 0; }
  return t;
}
export async function getExtras(rawId) {
  const { raw, uuid } = await details(rawId);
  // No recommendations on MangaDex: series that share this one's main genres, most followed first.
  const genreTags = (raw.attributes?.tags || []).filter((t) => t.attributes?.group === 'genre').map((t) => t.id).slice(0, 2);
  let recommendations = [];
  if (genreTags.length) {
    try {
      const d = await request('/manga', { ...BASE, includedTags: genreTags, 'order[followedCount]': 'desc', limit: 13 }, { ttl: 60 * 60 * 1000 });
      recommendations = (await list((d.data || []).filter((m) => m.id !== uuid))).slice(0, 12);
    } catch { /* none this time */ }
  }
  return { characters: [], recommendations };
}
/** Related series (sequels, prequels, spin-offs) take the place of anime "seasons". */
export async function getSeasons(rawId) {
  const id = String(rawId);
  const { raw } = await details(id);
  const related = rel(raw, 'manga').filter((r) => ['sequel', 'prequel', 'side_story', 'spin_off', 'main_story', 'serialization', 'adapted_from'].includes(r.related));
  if (!related.length) return { id, seasons: [] };
  const d = await request('/manga', { ids: related.map((r) => r.id).slice(0, 20), includes: ['cover_art'], contentRating: RATINGS, limit: 20 }, { ttl: 60 * 60 * 1000 });
  const titles = await list(d.data);
  const label = { sequel: 'Sequel', prequel: 'Prequel', side_story: 'Side story', spin_off: 'Spin-off', main_story: 'Main story', serialization: 'Serialization', adapted_from: 'Adapted from' };
  const byUuid = new Map(related.map((r) => [r.id, label[r.related] || 'Related']));
  const self = normalize(raw, id);
  const parts = [{ ...self, relation: null }, ...titles.map((t) => ({ ...t, relation: byUuid.get(t.mdId) || 'Related' }))];
  return {
    id,
    seasons: parts.map((p) => ({ id: p.id, title: p.title, titleRomaji: null, format: p.format, year: p.year, cover: p.cover, status: p.status, episodes: null, relation: p.relation })),
  };
}

// ---------- chapters ("episodes") ----------
const episodeCache = new Map();
const LANGS = new Set(['en', 'ar']);
export function cleanLangs(raw) {
  const out = String(raw || 'en').split(',').map((s) => s.trim().toLowerCase()).filter((l) => LANGS.has(l));
  return out.length ? [...new Set(out)] : ['en'];
}
/**
 * Every readable chapter in the chosen language(s), oldest first, one entry per chapter number
 * (the first language listed wins; then the version with the most pages). Numbered 1, 2, 3 …
 * straight through; each keeps its real chapter number, volume, groups and MangaDex chapter id.
 */
export async function getEpisodes(rawId, rawLangs = 'en') {
  const id = String(rawId);
  const langs = cleanLangs(rawLangs);
  const key = `${id}:${langs.join(',')}`;
  const hit = episodeCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const pending = (async () => {
    const uuid = await uuidOf(id);
    const all = [];
    let officialOnly = 0;
    for (let offset = 0; offset < 3000; offset += 500) {
      const d = await request(`/manga/${uuid}/feed`, {
        translatedLanguage: langs, contentRating: RATINGS, includes: ['scanlation_group'], includeEmptyPages: '0',
        'order[volume]': 'asc', 'order[chapter]': 'asc', limit: 500, offset,
      }, { ttl: 10 * 60 * 1000 });
      for (const c of d.data || []) {
        const a = c.attributes || {};
        if (!langs.includes(a.translatedLanguage)) continue; // only the languages asked for
        if (a.externalUrl || !a.pages) { officialOnly++; continue; } // links to the publisher, not readable here
        all.push(c);
      }
      if ((d.data || []).length < 500) break;
    }
    // One per chapter number; the preferred language first, then the fullest version.
    const best = new Map();
    for (const c of all) {
      const a = c.attributes;
      const num = a.chapter ?? `oneshot-${c.id}`;
      const rank = [langs.indexOf(a.translatedLanguage), -(a.pages || 0)];
      const cur = best.get(num);
      if (!cur || rank[0] < cur.rank[0] || (rank[0] === cur.rank[0] && rank[1] < cur.rank[1])) best.set(num, { c, rank });
    }
    const chapters = [...best.values()].map((x) => x.c).sort((x, y) => {
      const a = parseFloat(x.attributes.chapter), b = parseFloat(y.attributes.chapter);
      if (Number.isNaN(a) && Number.isNaN(b)) return 0;
      if (Number.isNaN(a)) return -1;
      if (Number.isNaN(b)) return 1;
      return a - b;
    });
    const episodes = chapters.map((c, i) => {
      const a = c.attributes;
      const n = i + 1;
      const label = a.chapter ? `Ch. ${a.chapter}` : 'Oneshot';
      return {
        id: `${id}:${n}`, number: n, title: a.title || (a.chapter ? `Chapter ${a.chapter}` : 'Oneshot'), label,
        chapter: a.chapter || null, volume: a.volume || null, chapterId: c.id, lang: a.translatedLanguage, pages: a.pages,
        groups: rel(c, 'scanlation_group').map((g) => g.attributes?.name).filter(Boolean), airDate: (a.publishAt || '').slice(0, 10),
        isFiller: false, isRecap: false,
      };
    });
    return { animeId: id, total: episodes.length, episodes, officialOnly, langs };
  })();
  episodeCache.set(key, { value: pending, expires: Date.now() + 10 * 60 * 1000 });
  if (episodeCache.size > 300) episodeCache.delete(episodeCache.keys().next().value);
  try {
    const value = await pending;
    episodeCache.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
    return value;
  } catch (err) { episodeCache.delete(key); throw err; }
}
export async function getAvailability(rawId) {
  const { total } = await getEpisodes(rawId);
  return { id: String(rawId), sub: total, dub: 0, total };
}
export async function getEpisodeAvailability(rawId, rawEpisode) {
  const { total } = await getEpisodes(rawId);
  const n = Number(rawEpisode);
  return { id: String(rawId), episode: n, sub: Number.isInteger(n) && n >= 1 && n <= total, dub: false };
}

// ---------- reading a chapter ----------
/** The page images of one chapter, as URLs on our image proxy. quality: 'data' or 'data-saver'. */
export async function getPages(rawId, rawEpisode, rawLangs = 'en', quality = 'data-saver') {
  const { episodes } = await getEpisodes(rawId, rawLangs);
  const ep = episodes.find((e) => e.number === Number(rawEpisode));
  if (!ep) throw fail(404, 'That chapter isn’t here.');
  // The page server address is only good for about 15 minutes: never kept longer than 5.
  const d = await request(`/at-home/server/${ep.chapterId}`, {}, { ttl: 5 * 60 * 1000 });
  const q = quality === 'data' ? 'data' : 'data-saver';
  const files = q === 'data' ? d.chapter?.data : d.chapter?.dataSaver;
  if (!d.baseUrl || !d.chapter?.hash || !files?.length) throw fail(502, 'This chapter’s pages couldn’t be loaded. Try again shortly.');
  return {
    episode: ep,
    quality: q,
    pages: files.map((f) => `/api/mdimg?u=${encodeURIComponent(`${d.baseUrl}/${q}/${d.chapter.hash}/${f}`)}`),
  };
}

// ---------- random ----------
export async function getRandom() {
  const d = await request('/manga/random', { contentRating: RATINGS, includes: ['cover_art'] }, { ttl: 1 });
  const [t] = await list([d.data]);
  if (!t) throw fail(503, 'No random pick this time. Try again.');
  return t;
}

// ---------- no schedule for manga ----------
export async function getSchedule(day) { return { day, results: [] }; }
