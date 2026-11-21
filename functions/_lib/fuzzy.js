// Small helpers for typo-tolerant title search (shared by the catalogues).

export function levenshtein(a, b) {
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
/** Lower case, punctuation to spaces: "Re:Zero!" -> "re zero". */
export const squash = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Smallest edit distance between the query and any same-length stretch of any title. */
export function closeness(query, titles) {
  const q = squash(query);
  let best = Infinity;
  for (const raw of titles) {
    const title = squash(raw);
    if (!title || !q) continue;
    if (title.length <= q.length) { best = Math.min(best, levenshtein(q, title)); continue; }
    for (let i = 0; i + q.length <= title.length; i++) best = Math.min(best, levenshtein(q, title.slice(i, i + q.length)));
  }
  return best;
}
export const containsQuery = (titles, query) => {
  const q = squash(query);
  return Boolean(q) && titles.some((t) => squash(t).includes(q));
};
/** Prefixes worth asking the catalogue for when a query finds nothing: "intersteller" -> inte, int. */
export function prefixesOf(query, lengths = [4, 3]) {
  const words = squash(query).split(' ').filter((w) => w.length >= 3).slice(0, 2);
  return [...new Set(words.flatMap((w) => lengths.map((n) => w.slice(0, n))).filter((p) => p.length >= 3))];
}
/** Ranks a pool of titles by closeness to the query, keeping the close ones. */
export function rankClose(query, pool, titlesOf) {
  const limit = Math.max(2, Math.ceil(squash(query).length * 0.4));
  return pool
    .map((item) => ({ item, distance: closeness(query, titlesOf(item)) }))
    .filter((x) => x.distance <= limit)
    .sort((a, b) => a.distance - b.distance || (b.item.popularity || 0) - (a.item.popularity || 0))
    .map((x) => x.item);
}
