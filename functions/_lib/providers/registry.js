// Built-in playback providers are resolved directly by this Worker. No external
// aggregator URL or separate provider backend is required.
import * as tenrai from './tenrai.js';
import * as megaplay from './megaplay.js';
import * as animeparadise from './animeparadise.js';
import * as vidnest from './vidnest.js';
import * as tryembed from './tryembed.js';
import * as tmdb from './tmdb.js';

const BUILTIN_ID = 'megaplay';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const CATEGORIES = new Set(['sub', 'dub']);
const BUILTIN_PROVIDERS = [
  // `name` is what visitors see on the server buttons: short neutral names, not the upstream
  // sites. `id` stays the real one, used in saved settings, reports, logs and the admin page.
  { id: 'megaplay', name: '3ellwa', categories: ['sub', 'dub'] },
  { id: 'animeparadise', name: 'Kaze', categories: ['sub'] },
  { id: 'vidnest', name: 'JoJo', categories: ['sub', 'dub'] },
  { id: 'tryembed', name: 'Hoshi', categories: ['sub', 'dub'] },
];

const fail = (status, message) => Object.assign(new Error(message), { status });
const episodeNumber = raw => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 2000) throw fail(400, 'Invalid episode number');
  return value;
};
const validAnimeId = raw => {
  const value = String(raw || '').trim();
  if (!/^\d{1,12}$/.test(value)) throw fail(400, 'That link doesn\'t point to a title.');
  return value;
};

function configuredProviders(env = {}) {
  const raw = env.ANIMEE_EMBED_PROVIDERS;
  if (!raw) return [];
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw fail(500, 'ANIMEE_EMBED_PROVIDERS must contain valid JSON.'); }
  if (!Array.isArray(parsed)) throw fail(500, 'ANIMEE_EMBED_PROVIDERS must be a JSON array.');

  const seen = new Set(BUILTIN_PROVIDERS.map(provider => provider.id));
  return parsed.map((item, index) => {
    const id = String(item?.id || '').trim().toLowerCase();
    const name = String(item?.name || '').trim().slice(0, 40);
    const template = String(item?.embedUrlTemplate || '').trim();
    const categories = Array.isArray(item?.categories)
      ? [...new Set(item.categories.map(x => String(x).toLowerCase()).filter(x => CATEGORIES.has(x)))]
      : ['sub', 'dub'];
    if (!ID_RE.test(id) || seen.has(id)) throw fail(500, `Invalid or duplicate playback provider id at index ${index}.`);
    if (!name || !template || !template.startsWith('https://') || !categories.length) {
      throw fail(500, `Playback provider "${id}" needs a name, an HTTPS embedUrlTemplate, and at least one supported category.`);
    }
    const sample = template.replaceAll('{malId}', '123').replaceAll('{episode}', '1').replaceAll('{category}', 'sub');
    let parsedUrl;
    try { parsedUrl = new URL(sample); } catch { throw fail(500, `Invalid embed URL template for "${id}".`); }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      throw fail(500, `Provider "${id}" must use a credential-free HTTPS URL.`);
    }
    seen.add(id);
    return { id, name, template, categories };
  });
}

// cinemee (movies and TV) has one server: VidNest, addressed by TMDB id. Neutral name, as on animee.
// Tried in this order. Orion (vidnext) resumes, reports progress and takes seek commands. Nova
// (VidNest) next, then Atlas (EmbedMaster). Vega (vidsrc) has subtitles in many languages, Arabic
// included, in its own menu. Lyra (VidCore) is last: it works but shows a lot of ads.
const CINEMEE_PROVIDERS = [
  { id: 'vidnext', name: 'Orion', categories: ['sub'] },
  { id: 'vidnest', name: 'Nova', categories: ['sub'] },
  { id: 'embedmaster', name: 'Atlas', categories: ['sub'] },
  { id: 'vidsrc', name: 'Vega', categories: ['sub'] },
  { id: 'vidcore', name: 'Lyra', categories: ['sub'] },
];
const CINEMEE_IDS = CINEMEE_PROVIDERS.map((p) => p.id);

export function getProviderList(env = {}) {
  if (env.SITE === 'cinemee') return CINEMEE_PROVIDERS.map((provider) => ({ ...provider, configured: true }));
  return [
    ...BUILTIN_PROVIDERS.map(provider => ({ ...provider, configured: true })),
    ...configuredProviders(env).map(({ id, name, categories }) => ({ id, name, categories, configured: true })),
  ];
}

export async function getServers(rawId, rawEpisode, env = {}) {
  const id = validAnimeId(rawId);
  episodeNumber(rawEpisode);
  return getProviderList(env).flatMap(provider => provider.categories.map(category => ({
    id: provider.id,
    provider: provider.id,
    name: provider.name,
    category,
    available: true,
  })));
}

// Provider health: after a few consecutive outages a provider is skipped for a while,
// so one dead upstream cannot add its full timeout to every episode. "Doesn't have this
// episode" (4xx) answers are normal and do not count as outages.
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
const health = new Map(); // id -> { fails, until }
export const playbackLimits = { providerMs: 8000, totalMs: 12000, minProviderMs: 3000 };

const isOutage = error => !error?.status || error.status >= 500;
function providerDown(id) {
  const entry = health.get(id);
  return Boolean(entry && entry.until > Date.now());
}
function recordResult(id, error) {
  if (!error) { health.delete(id); return; }
  if (!isOutage(error)) return;
  const entry = health.get(id) || { fails: 0, until: 0 };
  entry.fails += 1;
  if (entry.fails >= BREAKER_THRESHOLD) { entry.until = Date.now() + BREAKER_COOLDOWN_MS; entry.fails = 0; }
  health.set(id, entry);
}
export function resetProviderHealth() { health.clear(); }

/** Run one provider call with a deadline; a slow upstream becomes a 504 naming the provider. */
async function withDeadline(name, ms, task) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(fail(504, `${name} did not respond in time.`)), Math.max(1, ms));
  });
  try {
    return await Promise.race([task(), deadline]);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw fail(504, `${name} did not respond in time.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const fallbackCache = new Map();
const FALLBACK_CACHE_MS = 2 * 60 * 1000;
const FALLBACK_FAILURE_MS = 15 * 1000;
const STABLE_EMBED_PROVIDERS = new Set(['megaplay', 'vidnest', 'tryembed']);

/** Resolve one provider at a time and stop on the first successful source. */
export async function getFallbackSource(rawId, rawEpisode, rawPreferred, rawCategory, env = {}, opts = {}) {
  const id = validAnimeId(rawId);
  const episode = episodeNumber(rawEpisode);
  const category = String(rawCategory || 'sub').toLowerCase();
  if (!CATEGORIES.has(category)) throw fail(400, 'Invalid playback category.');
  const preferred = String(rawPreferred || BUILTIN_ID).trim().toLowerCase();
  // The site is part of the key: an anime and a movie can share the same number.
  const key = `${env.SITE || 'animee'}:${id}:${episode}:${category}:${preferred}`;
  const hit = fallbackCache.get(key);
  if (hit && hit.expires > Date.now()) {
    if (hit.error) throw fail(hit.status || 502, hit.error);
    return { ...hit.value, cached: true };
  }
  if (hit) fallbackCache.delete(key);

  const candidates = (await getServers(id, episode, env)).filter(item => item.category === category);
  candidates.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  const failures = [];

  const started = Date.now();
  for (const candidate of candidates) {
    if (providerDown(candidate.id)) {
      failures.push(`${candidate.name}: temporarily unavailable`);
      continue;
    }
    // Later providers get whatever is left of the overall budget, but never less than a short
    // floor: skipping the last provider outright would turn a slow first try into a hard failure.
    const remaining = playbackLimits.totalMs - (Date.now() - started);
    const budget = Math.max(playbackLimits.minProviderMs, Math.min(playbackLimits.providerMs, remaining));
    try {
      const source = await withDeadline(candidate.name, budget, async () => {
        if (candidate.id === BUILTIN_ID && !(await megaplay.isAvailable(id, episode, category))) {
          throw fail(404, 'episode unavailable');
        }
        return getSources(id, episode, candidate.id, category, env, opts);
      });
      const playable = Boolean(source?.embedUrl || source?.sources?.some(item => item?.url));
      if (!playable) throw fail(502, 'provider returned no playable source');
      recordResult(candidate.id, null);
      const result = {
        ...source,
        episodeId: `${id}:${episode}`,
        provider: candidate.id,
        providerName: candidate.name,
        fallback: candidate.id !== preferred,
      };
      // Direct stream URLs from scraped providers can expire. Cache only stable
      // iframe/template providers, not AnimeParadise resolutions.
      if (STABLE_EMBED_PROVIDERS.has(candidate.id) || !BUILTIN_PROVIDERS.some(provider => provider.id === candidate.id)) {
        fallbackCache.set(key, { value: result, expires: Date.now() + FALLBACK_CACHE_MS });
      }
      return result;
    } catch (error) {
      recordResult(candidate.id, error);
      failures.push(`${candidate.id}: ${error?.message || 'provider failed'}`);
    }
  }

  // Visitors get a plain message; the per-server reasons (which name the upstream sites)
  // go to the Worker logs instead.
  if (failures.length) console.warn(`playback: nothing resolved ${id}:${episode} ${category}: ${failures.join(' | ').slice(0, 800)}`);
  const message = failures.length
    ? `No server could play this episode in ${category} right now. Try again in a little while.`
    : `No servers are available for ${category}.`;
  fallbackCache.set(key, { error: message, status: 502, expires: Date.now() + FALLBACK_FAILURE_MS });
  throw fail(502, message);
}

/** A single, explicitly chosen provider, with the same deadline as automatic playback. */
export async function getDirectSources(rawId, rawEpisode, rawServer, rawCategory, env = {}, opts = {}) {
  const server = String(rawServer || BUILTIN_ID).trim().toLowerCase();
  const provider = getProviderList(env).find(item => item.id === server);
  try {
    return await withDeadline(provider?.name || 'That server', playbackLimits.providerMs,
      () => getSources(rawId, rawEpisode, server, rawCategory, env, opts));
  } catch (error) {
    if (error?.status === 400 || error?.status === 504 || !provider) throw error;
    console.warn(`playback: ${server} failed for ${rawId}:${rawEpisode}: ${error?.message || error}`);
    throw fail(error?.status && error.status < 500 ? error.status : 502, `${provider.name} couldn't play this episode.`);
  }
}

/** opts.aniListId: the show's AniList ID, looked up by the browser (VidNest and TryEmbed need it). */
export async function getSources(rawId, rawEpisode, rawServer, rawCategory, env = {}, opts = {}) {
  const id = validAnimeId(rawId);
  const episode = episodeNumber(rawEpisode);
  const server = String(rawServer || BUILTIN_ID).trim().toLowerCase();
  const category = String(rawCategory || 'sub').toLowerCase();
  if (!CATEGORIES.has(category)) throw fail(400, 'Invalid playback category.');

  if (env.SITE === 'cinemee') {
    if (!CINEMEE_IDS.includes(server)) throw fail(404, 'That playback server is not configured.');
    return tmdb.getSources(id, episode, server);
  }
  if (server === 'megaplay') return tenrai.getSources(id, episode, category);
  if (server === 'animeparadise') return animeparadise.getSources(id, episode, category);
  if (server === 'vidnest') return vidnest.getSources(id, episode, category, opts.aniListId);
  if (server === 'tryembed') return tryembed.getSources(id, episode, category, opts.aniListId);

  const provider = configuredProviders(env).find(item => item.id === server);
  if (!provider) throw fail(404, 'That playback server is not configured.');
  if (!provider.categories.includes(category)) throw fail(404, `${provider.name} does not offer ${category}.`);
  const embedUrl = provider.template
    .replaceAll('{malId}', encodeURIComponent(id))
    .replaceAll('{episode}', String(episode))
    .replaceAll('{category}', category);
  let parsed;
  try { parsed = new URL(embedUrl); } catch { throw fail(500, `Invalid embed URL for ${provider.name}.`); }
  if (parsed.protocol !== 'https:') throw fail(500, 'Playback embeds must use HTTPS.');
  return { embedUrl: parsed.toString(), embedOrigin: parsed.origin, language: category, provider: provider.id, events: [] };
}
