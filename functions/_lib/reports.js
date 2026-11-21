// POST /api/report — "this episode didn't play" counters, from the Report button and from
// automatic server switches on the watch page.
//
// Storage stays tiny and bounded: one row per (show, episode, server, language, reason, day)
// holding a count, and rows older than 30 days are deleted now and then. Nothing about the
// viewer is stored. Read them with, for example:
//   npx wrangler d1 execute animee-space --remote --command \
//     "SELECT provider, reason, SUM(n) FROM reports WHERE day > unixepoch()/86400 - 7 GROUP BY 1, 2"

import { getProviderList } from './providers/registry.js';

export const REASONS = ['auto', 'video', 'wrong', 'subs', 'audio', 'other'];
const KEEP_DAYS = 30;

const CREATE = `CREATE TABLE IF NOT EXISTS reports (
  anime_id INTEGER NOT NULL,
  ep       INTEGER NOT NULL,
  provider TEXT    NOT NULL,
  cat      INTEGER NOT NULL,
  reason   INTEGER NOT NULL,
  day      INTEGER NOT NULL,
  n        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (anime_id, ep, provider, cat, reason, day)
) WITHOUT ROWID`;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// Returns the cleaned report, or null when anything is off.
export function cleanReport(body, providerIds) {
  const anime = String(body?.a ?? '');
  const ep = Number(body?.ep);
  const provider = String(body?.p ?? '').toLowerCase();
  const reason = REASONS.indexOf(String(body?.r ?? ''));
  if (!/^\d{1,12}$/.test(anime) || !Number.isInteger(ep) || ep < 1 || ep > 2000) return null;
  if (!providerIds.includes(provider) || reason < 0) return null;
  return { anime: Number(anime), ep, provider, cat: body?.c === 'dub' ? 1 : 0, reason };
}

export async function handleReport(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.DB) return json({ error: 'Reports need the D1 database binding "DB".' }, 503);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin' }, 403);
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json({ error: 'Expected JSON' }, 415);
  const text = await request.text();
  if (text.length > 2000) return json({ error: 'Request too large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const report = cleanReport(body, getProviderList(env).map((p) => p.id));
  if (!report) return json({ error: 'Invalid report' }, 400);

  if (env.REPORT_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REPORT_LIMITER.limit({ key: ip }).catch(() => ({ success: true }));
    if (!success) return json({ ok: true }); // quietly drop floods
  }

  const day = Math.floor(Date.now() / 86400000);
  const insert = () => env.DB.prepare(
    `INSERT INTO reports (anime_id, ep, provider, cat, reason, day) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (anime_id, ep, provider, cat, reason, day) DO UPDATE SET n = n + 1`,
  ).bind(report.anime, report.ep, report.provider, report.cat, report.reason, day).run();
  try {
    await insert();
  } catch (err) {
    // First report after a deploy: the table is created here, so no manual migration is needed.
    if (!/no such table/i.test(String(err?.message))) throw err;
    await env.DB.prepare(CREATE).run();
    await insert();
  }
  // Roughly one report in fifty also clears out old days.
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM reports WHERE day < ?').bind(day - KEEP_DAYS).run().catch(() => {});
  }
  return json({ ok: true });
}
