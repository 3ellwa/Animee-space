// "Popular on animee / cinemee this week": what people here actually play.
//
//   POST /api/play { a }      a show started playing (each browser sends it once per show per day)
//   GET  /api/popular-here    -> { results } the most played shows of the last 7 days
//
// One row per (day, show) with a count, nothing about who: rows older than 8 days are deleted
// now and then. A show needs plays on at least two separate occasions to be listed.

const KEEP_DAYS = 8;
const CREATE = `CREATE TABLE IF NOT EXISTS plays (
  day      INTEGER NOT NULL,
  anime_id INTEGER NOT NULL,
  n        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, anime_id)
) WITHOUT ROWID`;
const today = () => Math.floor(Date.now() / 86400000);
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function handlePlay(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.DB) return json({ ok: true });
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin' }, 403);
  const text = await request.text();
  if (text.length > 200) return json({ error: 'Too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const id = String(body?.a ?? '');
  if (!/^\d{1,12}$/.test(id)) return json({ error: 'Invalid show' }, 400);
  if (env.REPORT_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REPORT_LIMITER.limit({ key: 'play:' + ip }).catch(() => ({ success: true }));
    if (!success) return json({ ok: true });
  }
  const day = today();
  const insert = () => env.DB.prepare(
    'INSERT INTO plays (day, anime_id) VALUES (?, ?) ON CONFLICT (day, anime_id) DO UPDATE SET n = n + 1',
  ).bind(day, Number(id)).run();
  try { await insert(); } catch (err) {
    if (!/no such table/i.test(String(err?.message))) throw err;
    await env.DB.prepare(CREATE).run();
    await insert();
  }
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM plays WHERE day < ?').bind(day - KEEP_DAYS).run().catch(() => {});
  return json({ ok: true });
}

/** Most played shows of the last 7 days, with their details from the catalogue. */
export async function popularHere(env, catalogue, limit = 20) {
  if (!env.DB) return { results: [] };
  let rows = [];
  try {
    ({ results: rows } = await env.DB.prepare(
      'SELECT anime_id, SUM(n) AS n FROM plays WHERE day >= ? GROUP BY anime_id HAVING SUM(n) >= 2 ORDER BY n DESC LIMIT ?',
    ).bind(today() - 6, limit).all());
  } catch { return { results: [] }; }
  const results = [];
  for (let i = 0; i < (rows || []).length; i += 6) {
    const found = await Promise.all(rows.slice(i, i + 6).map((r) => catalogue.getAnime(String(r.anime_id)).then((a) => ({ ...a, plays: r.n })).catch(() => null)));
    results.push(...found.filter(Boolean));
  }
  return { results };
}
