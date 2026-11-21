// Shareable lists: a read-only page of someone's list at /u/<name>, only when they turn it on.
//
//   GET  /api/me/share                     (signed in) -> { mode, url }
//   POST /api/me/share  { mode }           (signed in) mode: 'off' | 'all' | 'favourites'
//   GET  /api/u/<name>                     -> { name, mode, items: [...] } or 404 when not shared
//
// The choice lives in two spare bits of users.prefs (16 = whole list, 32 = favourites only), so
// nothing new is stored. A shared page shows titles, list status, favourites and the owner's own
// ratings; never progress, history or anything else. Unknown names and lists that aren't shared
// both answer the same 404, so the page doesn't reveal who has an account.

export const SHARE_ALL = 16;
export const SHARE_FAVOURITES = 32;
export const SHARE_BITS = SHARE_ALL | SHARE_FAVOURITES;
const STATUS = ['', 'watching', 'planning', 'completed', 'paused', 'dropped', 'notinterested'];
const MAX_ITEMS = 60;

export const shareMode = (prefs) => (prefs & SHARE_ALL ? 'all' : prefs & SHARE_FAVOURITES ? 'favourites' : 'off');
export const shareBits = (mode) => (mode === 'all' ? SHARE_ALL : mode === 'favourites' ? SHARE_FAVOURITES : 0);

/** Which library rows a shared page shows: listed, favourite or rated; never "not interested". */
export function visibleRow(s, mode) {
  const status = s & 7;
  const fav = Boolean(s & 8);
  const rated = ((s >> 7) & 15) > 0;
  if (mode === 'favourites') return fav;
  if (status === 6) return fav;
  return fav || rated || (status >= 1 && status <= 5);
}

export async function publicList(env, rawName, catalogue) {
  const name = String(rawName || '').toLowerCase();
  const fail = () => Object.assign(new Error('This list isn’t shared (or doesn’t exist).'), { status: 404 });
  if (!/^[a-z0-9_]{3,20}$/.test(name)) throw fail();
  const user = await env.DB.prepare('SELECT id, name, prefs FROM users WHERE name = ?').bind(name).first();
  const mode = user ? shareMode(user.prefs) : 'off';
  if (mode === 'off') throw fail();
  const { results } = await env.DB.prepare('SELECT anime_id, s, u FROM library WHERE user_id = ? AND s != 0 ORDER BY u DESC LIMIT 400')
    .bind(user.id).all();
  const rows = (results || []).filter((r) => visibleRow(r.s, mode)).slice(0, MAX_ITEMS);
  const items = [];
  // A few lookups at a time; titles the catalogue can't give right now are left out.
  for (let i = 0; i < rows.length; i += 6) {
    const found = await Promise.all(rows.slice(i, i + 6).map(async (r) => {
      try {
        const a = await catalogue.getAnime(String(r.anime_id));
        return { ...a, status: STATUS[r.s & 7] || null, favourite: Boolean(r.s & 8), rating: (r.s >> 7) & 15 };
      } catch { return null; }
    }));
    items.push(...found.filter(Boolean));
  }
  return { name: user.name, mode, items, total: rows.length };
}
