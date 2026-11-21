// Error counts for the admin page: which API routes fail (5xx) and which pages break in the
// browser, per day. Bounded like the reports: one row per (day, kind, place) with a count,
// and rows older than 30 days are deleted now and then. Nothing about the visitor is stored.
//
//   POST /api/error { place, message }   from the browser (page crashes), rate-limited
//   recordError(env, 'api', place)       from the API router on 5xx answers

const KEEP_DAYS = 30;
const CREATE = `CREATE TABLE IF NOT EXISTS errors (
  day   INTEGER NOT NULL,
  kind  TEXT    NOT NULL,
  place TEXT    NOT NULL,
  n     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, kind, place)
) WITHOUT ROWID`;
const KINDS = ['api', 'page'];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** "anime/52991/episodes" -> "anime/:id/episodes": one row per route, not per show. */
export function routeOf(pathname) {
  return String(pathname || '').replace(/^\/?api\//, '').split('/').filter(Boolean).slice(0, 4)
    .map((part) => (/\d/.test(part) ? ':id' : part.replace(/[^a-z0-9_-]/gi, '').slice(0, 24))).join('/') || '/';
}
/** A short, data-free label for a browser error: the view plus the first line of the message. */
export function cleanPlace(place, message) {
  const view = String(place || '').replace(/[^a-z0-9_/-]/gi, '').slice(0, 30) || 'page';
  const msg = String(message || '').split('\n')[0].replace(/https?:\/\/\S+/g, '<url>').replace(/\d{3,}/g, '#').replace(/\s+/g, ' ').trim().slice(0, 90);
  return msg ? `${view}: ${msg}` : view;
}

export async function recordError(env, kind, place) {
  if (!env?.DB || !KINDS.includes(kind)) return;
  const day = Math.floor(Date.now() / 86400000);
  const insert = () => env.DB.prepare(
    `INSERT INTO errors (day, kind, place) VALUES (?, ?, ?)
     ON CONFLICT (day, kind, place) DO UPDATE SET n = n + 1`,
  ).bind(day, kind, String(place).slice(0, 140)).run();
  try {
    await insert();
  } catch (err) {
    if (!/no such table/i.test(String(err?.message))) return;
    try { await env.DB.prepare(CREATE).run(); await insert(); } catch { /* give up quietly */ }
  }
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM errors WHERE day < ?').bind(day - KEEP_DAYS).run().catch(() => {});
}

export async function handleClientError(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin' }, 403);
  const text = await request.text();
  if (text.length > 2000) return json({ error: 'Request too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (env.REPORT_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REPORT_LIMITER.limit({ key: 'err:' + ip }).catch(() => ({ success: true }));
    if (!success) return json({ ok: true });
  }
  await recordError(env, 'page', cleanPlace(body?.place, body?.message));
  return json({ ok: true });
}

/** Last 7 days, newest day first, biggest counts first. */
export async function recentErrors(env) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT day, kind, place, n FROM errors WHERE day > ? ORDER BY day DESC, n DESC LIMIT 200',
    ).bind(Math.floor(Date.now() / 86400000) - 7).all();
    return results || [];
  } catch { return []; }
}
