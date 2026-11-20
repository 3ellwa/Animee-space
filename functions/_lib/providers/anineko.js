import { animeMetadata, chooseAnimeMatch, episodeNumber, fetchText } from './matching.js';

const BASE = 'https://anineko.to';
const fail = (status, message) => Object.assign(new Error(message), { status });

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
  const match = String(tag || '').match(re);
  return match ? match[2].replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/') : '';
}
function stripTags(value) {
  return String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
}
function searchResults(html) {
  return [...html.matchAll(/<article\b[^>]*class=["'][^"']*nv-anime-card[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].map(match => {
    const block = match[1];
    const heading = block.match(/<h3\b[^>]*class=["'][^"']*nv-anime-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '';
    const titleTag = heading.match(/<a\b[^>]*>/i)?.[0]
      || block.match(/<a\b[^>]*class=["'][^"']*nv-anime-thumb[^"']*["'][^>]*>/i)?.[0] || '';
    const inner = heading.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] || titleTag;
    return { id: attr(titleTag, 'href'), title: attr(titleTag, 'title') || stripTags(inner) };
  }).filter(item => item.id && item.title);
}
function episodeRows(html) {
  return [...html.matchAll(/<article\b[^>]*class=["'][^"']*nv-info-episode-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)].map(match => {
    const block = match[1];
    const anchor = block.match(/<a\b[^>]*class=["'][^"']*nv-info-episode-main[^"']*["'][^>]*>/i)?.[0] || '';
    const href = attr(anchor, 'href');
    const found = href.match(/ep-(\d+(?:\.\d+)?)/i);
    const title = stripTags(block);
    return { href, number: found ? Number(found[1]) : null, title };
  }).filter(item => item.href && item.number != null);
}
function serverUrls(html) {
  return [...html.matchAll(/<button\b[^>]*class=["'][^"']*nv-server-btn[^"']*["'][^>]*>/gi)]
    .map(match => attr(match[0], 'data-video'))
    .filter(value => /^https:\/\//i.test(value));
}
function isDirectMedia(value) {
  return /\.(m3u8|mp4)(?:[?#]|$)/i.test(value);
}
function findDirectMedia(html) {
  const unescaped = String(html || '').replace(/\\\//g, '/');
  const match = unescaped.match(/https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4)(?:[?#][^"'\s<>\\]*)?/i);
  return match ? match[0].replace(/\\\//g, '/') : null;
}

export async function getSources(rawId, rawEpisode, category = 'sub') {
  if (category !== 'sub') throw fail(404, 'AniNeko currently provides subbed episodes only.');
  const id = String(rawId);
  const ep = episodeNumber(rawEpisode);
  if (!ep || ep < 1) throw fail(400, 'Invalid episode number.');
  const anime = await animeMetadata(id);
  const queries = [anime.title, anime.titleRomaji, anime.titleNative, ...(anime.synonyms || [])].filter(Boolean);
  let match = null;
  let lastError = null;
  for (const query of [...new Set(queries)].slice(0, 2)) {
    try {
      const page = await fetchText(`${BASE}/browser?keyword=${encodeURIComponent(query)}`, { headers: { Referer: `${BASE}/` } });
      const results = searchResults(page.text);
      if (results.length) {
        match = chooseAnimeMatch(anime, results, item => item.title);
        break;
      }
    } catch (error) { lastError = error; }
  }
  if (!match) throw lastError || fail(404, 'AniNeko could not find a confident title match.');

  const watchPath = match.id.startsWith('/') ? match.id : `/${match.id}`;
  const watchPage = await fetchText(`${BASE}${watchPath}`, { headers: { Referer: `${BASE}/` } });
  const selected = episodeRows(watchPage.text).find(item => item.number === ep);
  if (!selected) throw fail(404, `AniNeko does not have episode ${ep}.`);

  const episodeUrl = new URL(selected.href, BASE).toString();
  const episodePage = await fetchText(episodeUrl, { headers: { Referer: `${BASE}/` } });
  const embeds = serverUrls(episodePage.text);
  if (!embeds.length) throw fail(502, 'AniNeko returned no playable server links.');

  // Resolve simple HLS/MP4 links where the page exposes them. If it is an embed,
  // load that provider in the existing iframe player instead of pretending it is a video file.
  let source = null;
  let embedUrl = null;
  for (const url of embeds) {
    if (isDirectMedia(url)) {
      source = { type: url.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4', url };
      break;
    }
    try {
      const embed = await fetchText(url, { headers: { Referer: episodeUrl } });
      const direct = findDirectMedia(embed.text);
      if (direct) {
        source = { type: direct.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4', url: direct };
        break;
      }
    } catch { /* try the next server */ }
    if (!embedUrl) embedUrl = url;
  }
  if (!source && !embedUrl) throw fail(502, 'AniNeko servers did not return a playable source.');

  const result = source ? { sources: [source], tracks: [], language: 'sub' } : {
    embedUrl,
    embedOrigin: new URL(embedUrl).origin,
    language: 'sub',
    sources: [],
    tracks: [],
  };
  return result;
}
