// AniList GraphQL client — free, legal metadata (titles, posters, episodes, schedule).
// Docs: https://docs.anilist.co  (rate limit ~90 req/min, so the router caches responses)

const ENDPOINT = 'https://graphql.anilist.co';

const CARD = `
fragment card on Media {
  id
  title { romaji english native userPreferred }
  coverImage { extraLarge large color }
  bannerImage
  format
  status
  episodes
  duration
  averageScore
  popularity
  season
  seasonYear
  genres
  isAdult
  nextAiringEpisode { episode airingAt timeUntilAiring }
}`;

export async function anilist(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: query + CARD, variables }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors) {
    const err = new Error(body?.errors?.[0]?.message || `AniList returned HTTP ${res.status}`);
    err.status = res.status === 429 ? 429 : res.status === 404 ? 404 : 502;
    throw err;
  }
  return body.data;
}

// ---------- helpers ----------

export function currentSeason(date = new Date()) {
  const m = date.getUTCMonth() + 1;
  let year = date.getUTCFullYear();
  let season;
  if (m === 12) { season = 'WINTER'; year += 1; }
  else if (m <= 2) season = 'WINTER';
  else if (m <= 5) season = 'SPRING';
  else if (m <= 8) season = 'SUMMER';
  else season = 'FALL';
  return { season, year };
}

// How many episodes actually exist right now (airing shows aren't finished yet)
export function availableEpisodes(m) {
  if (m.status === 'NOT_YET_RELEASED') return 0;
  if (m.nextAiringEpisode?.episode) return Math.max(0, m.nextAiringEpisode.episode - 1);
  return m.episodes || (m.format === 'MOVIE' ? 1 : 0);
}

const stripHtml = (s) => (s || '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export function card(m) {
  if (!m) return null;
  return {
    id: m.id,
    title: m.title?.english || m.title?.romaji || m.title?.userPreferred || 'Untitled',
    titleRomaji: m.title?.romaji || null,
    titleNative: m.title?.native || null,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
    color: m.coverImage?.color || null,
    banner: m.bannerImage || null,
    format: m.format || null,
    status: m.status || null,
    episodes: m.episodes ?? null,
    availableEpisodes: availableEpisodes(m),
    duration: m.duration ?? null,
    score: m.averageScore ?? null,
    popularity: m.popularity ?? null,
    season: m.season || null,
    year: m.seasonYear || null,
    genres: m.genres || [],
    nextAiring: m.nextAiringEpisode || null,
    ...(m.description !== undefined ? { description: stripHtml(m.description) } : {}),
  };
}

const cards = (list) => (list || []).filter((m) => m && !m.isAdult).map(card);

// ---------- queries ----------

export async function getHome() {
  const { season, year } = currentSeason();
  const data = await anilist(`
    query ($season: MediaSeason, $year: Int) {
      trending: Page(perPage: 20) { media(sort: TRENDING_DESC, type: ANIME, isAdult: false) { ...card description(asHtml: false) } }
      season: Page(perPage: 18) { media(season: $season, seasonYear: $year, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ...card } }
      airing: Page(perPage: 18) { media(status: RELEASING, sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ...card } }
      popular: Page(perPage: 18) { media(sort: POPULARITY_DESC, type: ANIME, isAdult: false) { ...card } }
      top: Page(perPage: 10) { media(sort: SCORE_DESC, type: ANIME, isAdult: false) { ...card } }
    }`, { season, year });

  const trending = cards(data.trending.media);
  return {
    seasonInfo: { season, year },
    spotlight: trending.filter((a) => a.banner).slice(0, 8),
    trending,
    season: cards(data.season.media),
    airing: cards(data.airing.media),
    popular: cards(data.popular.media),
    top: cards(data.top.media),
  };
}

const SORTS = ['POPULARITY_DESC', 'TRENDING_DESC', 'SCORE_DESC', 'START_DATE_DESC', 'TITLE_ROMAJI', 'SEARCH_MATCH'];
const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA'];
const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED'];
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const pick = (v, list) => (list.includes(v) ? v : null);

export async function searchAnime(params) {
  const q = (params.get('q') || '').trim().slice(0, 100) || null;
  const year = parseInt(params.get('year'), 10);
  const page = Math.min(Math.max(parseInt(params.get('page'), 10) || 1, 1), 500);
  const genre = (params.get('genre') || '').trim();
  const sort = pick(params.get('sort'), SORTS) || (q ? 'SEARCH_MATCH' : 'POPULARITY_DESC');

  const data = await anilist(`
    query ($page: Int, $search: String, $genre: [String], $year: Int, $season: MediaSeason,
           $format: MediaFormat, $status: MediaStatus, $sort: [MediaSort]) {
      Page(page: $page, perPage: 24) {
        pageInfo { currentPage hasNextPage lastPage total }
        media(type: ANIME, isAdult: false, search: $search, genre_in: $genre, seasonYear: $year,
              season: $season, format: $format, status: $status, sort: $sort) { ...card }
      }
    }`, {
    page,
    search: q,
    genre: genre ? [genre.slice(0, 40)] : null,
    year: year >= 1940 && year <= 2100 ? year : null,
    season: pick(params.get('season'), SEASONS),
    format: pick(params.get('format'), FORMATS),
    status: pick(params.get('status'), STATUSES),
    sort: [sort],
  });
  return { pageInfo: data.Page.pageInfo, results: cards(data.Page.media) };
}

export async function getAnime(id) {
  const data = await anilist(`
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ...card
        description(asHtml: false)
        startDate { year month day }
        endDate { year month day }
        studios(isMain: true) { nodes { name } }
        synonyms
        source
        favourites
        trailer { id site }
        relations { edges { relationType node { ...card type } } }
        recommendations(perPage: 12, sort: RATING_DESC) { nodes { mediaRecommendation { ...card } } }
        characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
          edges { role node { name { full } image { medium } } voiceActors(language: JAPANESE) { name { full } image { medium } } }
        }
        externalLinks { site url type }
      }
    }`, { id });

  const m = data.Media;
  if (!m || m.isAdult) {
    const err = new Error('Anime not found');
    err.status = 404;
    throw err;
  }
  return {
    ...card(m),
    startDate: m.startDate,
    endDate: m.endDate,
    studios: (m.studios?.nodes || []).map((s) => s.name),
    synonyms: m.synonyms || [],
    source: m.source,
    favourites: m.favourites,
    trailer: m.trailer?.site === 'youtube' ? m.trailer.id : null,
    relations: (m.relations?.edges || [])
      .filter((e) => e.node?.type === 'ANIME' && !e.node.isAdult)
      .map((e) => ({ relation: e.relationType, ...card(e.node) })),
    recommendations: cards((m.recommendations?.nodes || []).map((n) => n.mediaRecommendation)),
    characters: (m.characters?.edges || []).map((e) => ({
      name: e.node?.name?.full,
      image: e.node?.image?.medium,
      role: e.role,
      va: e.voiceActors?.[0] ? { name: e.voiceActors[0].name.full, image: e.voiceActors[0].image?.medium } : null,
    })),
    // Official/legal places to watch — useful even after launch
    streamingLinks: (m.externalLinks || []).filter((l) => l.type === 'STREAMING').map((l) => ({ site: l.site, url: l.url })),
  };
}

export async function getMany(ids) {
  const data = await anilist(`
    query ($ids: [Int]) {
      Page(perPage: 50) { media(id_in: $ids, type: ANIME) { ...card } }
    }`, { ids });
  return { results: cards(data.Page.media) };
}

export async function getSchedule(start, end) {
  const items = [];
  for (let page = 1; page <= 4; page++) {
    const data = await anilist(`
      query ($start: Int, $end: Int, $page: Int) {
        Page(page: $page, perPage: 50) {
          pageInfo { hasNextPage }
          airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
            airingAt episode media { ...card }
          }
        }
      }`, { start, end, page });
    for (const s of data.Page.airingSchedules) {
      if (s.media && !s.media.isAdult) items.push({ airingAt: s.airingAt, episode: s.episode, anime: card(s.media) });
    }
    if (!data.Page.pageInfo.hasNextPage) break;
  }
  return { start, end, items };
}
