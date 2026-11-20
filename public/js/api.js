// Tiny fetch wrapper for /api with in-memory caching per page session
const memo = new Map();

// Changing this makes browsers skip API copies they saved before (they used to keep some for a day).
// API responses now expire from browsers within 10 minutes, so it rarely needs changing.
const API_VERSION = '3';

export function api(path, { fresh = false } = {}) {
  if (!fresh && memo.has(path)) return memo.get(path);
  const url = '/api' + path + (path.includes('?') ? '&' : '?') + 'v=' + API_VERSION;
  const p = fetch(url, { headers: { Accept: 'application/json' } }).then(async (r) => {
    const data = await r.json().catch(() => ({ error: 'Bad response from server' }));
    if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
    return data;
  });
  if (!fresh) {
    memo.set(path, p);
    p.catch(() => memo.delete(path));
  }
  return p;
}
