// Tiny fetch wrapper for /api with in-memory caching per page session
const memo = new Map();

export function api(path, { fresh = false } = {}) {
  if (!fresh && memo.has(path)) return memo.get(path);
  const p = fetch('/api' + path, { headers: { Accept: 'application/json' } }).then(async (r) => {
    const data = await r.json().catch(() => ({ error: 'Bad response from server' }));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  });
  if (!fresh) {
    memo.set(path, p);
    p.catch(() => memo.delete(path));
  }
  return p;
}
