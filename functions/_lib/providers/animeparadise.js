import { animeMetadata, chooseAnimeMatch, episodeNumber, fetchJson } from './matching.js';

const API = 'https://api.animeparadise.moe';
const STREAM = 'https://stream.animeparadise.moe';
const fail = (status, message) => Object.assign(new Error(message), { status });

function normalizeTracks(raw) {
  const input = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  return input.map((track, index) => {
    const url = track?.url || track?.file || track?.src || track?.link;
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
    return {
      url,
      label: String(track?.label || track?.lang || `Subtitle ${index + 1}`).slice(0, 40),
      lang: String(track?.lang || track?.language || 'und').slice(0, 12),
      default: Boolean(track?.default),
    };
  }).filter(Boolean);
}

export async function getSources(rawId, rawEpisode, category = 'sub') {
  if (category !== 'sub') throw fail(404, 'AnimeParadise only provides subbed episodes.');
  const id = String(rawId);
  const ep = episodeNumber(rawEpisode);
  if (!ep || ep < 1) throw fail(400, 'Invalid episode number.');
  const anime = await animeMetadata(id);
  const query = anime.title || anime.titleRomaji || anime.titleNative;
  const search = await fetchJson(`${API}/search?q=${encodeURIComponent(query)}&limit=20`);
  const match = chooseAnimeMatch(anime, search.data, item => item?.alternativeTitle?.english || item?.title, item => item?.year || (item?.released ? new Date(item.released).getUTCFullYear() : null));
  if (!match?._id) throw fail(502, 'AnimeParadise search result has no anime ID.');

  const episodePayload = await fetchJson(`${API}/anime/${encodeURIComponent(match._id)}/episode`);
  const items = Array.isArray(episodePayload.data) ? episodePayload.data : [];
  const selected = items.find(item => episodeNumber(item?.number) === ep && item?.uid);
  if (!selected) throw fail(404, `AnimeParadise does not have episode ${ep}.`);

  const detail = await fetchJson(`${API}/ep/${encodeURIComponent(selected.uid)}?origin=${encodeURIComponent(match._id)}`);
  const streamLink = detail?.data?.episode?.streamLink;
  if (typeof streamLink !== 'string' || !streamLink) throw fail(502, 'AnimeParadise did not return a stream link.');

  const streamUrl = `${STREAM}/m3u8?url=${encodeURIComponent(streamLink)}`;
  const result = {
    sources: [{ type: 'hls', url: `/api/stream-proxy?provider=animeparadise&url=${encodeURIComponent(streamUrl)}` }],
    tracks: normalizeTracks(detail?.data?.episode?.subData),
    language: 'sub',
  };
  return result;
}
