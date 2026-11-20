// Reads a public AniList anime list and maps it to animee space list entries (keyed by MAL ID).
// MyAnimeList lists are imported in the browser from MAL's XML export instead, since MAL's
// own API needs a registered client ID.
const ANILIST = 'https://graphql.anilist.co';
const fail = (status, message) => Object.assign(new Error(message), { status });

const STATUS = { CURRENT: 'watching', REPEATING: 'watching', PLANNING: 'planning', COMPLETED: 'completed', PAUSED: 'paused', DROPPED: 'dropped' };

const QUERY = `query ($user: String) {
  MediaListCollection(userName: $user, type: ANIME) {
    lists { entries { status progress media { idMal isAdult format episodes seasonYear title { english romaji } coverImage { large } } } }
  }
}`;

export async function importAniList(rawUser) {
  const user = String(rawUser || '').trim();
  if (!/^[A-Za-z0-9_]{2,20}$/.test(user)) throw fail(400, 'Enter a valid AniList username.');
  let response;
  try {
    response = await fetch(ANILIST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { user } }),
    });
  } catch {
    throw fail(502, 'AniList could not be reached. Try again in a minute.');
  }
  const payload = await response.json().catch(() => null);
  if (response.status === 429) throw fail(429, 'AniList is busy. Try again in a minute.');
  const message = payload?.errors?.[0]?.message || '';
  if (/not found|private/i.test(message) || response.status === 404) throw fail(404, 'No public AniList list found for that username.');
  if (!response.ok || !payload?.data?.MediaListCollection) throw fail(502, 'AniList returned an error. Try again later.');

  const seen = new Set();
  const items = [];
  let skipped = 0;
  for (const list of payload.data.MediaListCollection.lists || []) {
    for (const entry of list.entries || []) {
      const media = entry.media || {};
      const status = STATUS[entry.status];
      // Adult titles and shows without a MAL ID are not in this catalogue.
      if (!media.idMal || media.isAdult || !status) { skipped++; continue; }
      const id = String(media.idMal);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        status,
        title: media.title?.english || media.title?.romaji || null,
        cover: media.coverImage?.large || null,
        format: media.format || null,
        episodes: media.episodes ?? null,
        year: media.seasonYear ?? null,
        watchedUpTo: entry.status === 'COMPLETED' ? media.episodes || entry.progress || 0 : entry.progress || 0,
      });
    }
  }
  return { user, items, skipped };
}
