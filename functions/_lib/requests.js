// Requests ("Ask us something") and the small admin API used to answer them.
//
//   POST /api/requests            { who, kind, anime?, message }  -> { ok }
//   GET  /api/requests?who=...                                     -> { requests: [...] }
//   GET  /api/admin/requests      (X-Admin-Key)                    -> { requests, reports }
//   POST /api/admin/answer        (X-Admin-Key) { id, answer }     -> { ok }
//   POST /api/admin/delete        (X-Admin-Key) { id }             -> { ok }
//   POST /api/admin/notice        (X-Admin-Key) { text, level, link, hours } -> { notice } (see notice.js)
//   POST /api/admin/undemote      (X-Admin-Key) { anime, ep?, provider, category } -> { ok } (see ranking.js)
//
// `who` is a random id the browser makes once and keeps, so answers come back to the same
// browser without an account; signed-in people also see their requests on every device.
// Storage is bounded: at most 5,000 rows, and answered requests are deleted after 90 days.
// The admin key is the ADMIN_KEY secret (16+ characters); without it the admin API is off.

import { currentUser } from './auth.js';
import { currentNotice, setNotice } from './notice.js';
import { recentErrors } from './errors.js';
import { demotedList, clearDemotion } from './ranking.js';

export const KINDS = ['anime', 'idea', 'broken', 'other'];
const MAX_ROWS = 5000;
const KEEP_ANSWERED_DAYS = 90;

const CREATE = `CREATE TABLE IF NOT EXISTS requests (
  id       INTEGER PRIMARY KEY,
  who      TEXT    NOT NULL,
  user_id  INTEGER,
  kind     INTEGER NOT NULL,
  anime    TEXT,
  message  TEXT    NOT NULL,
  answer   TEXT,
  created  INTEGER NOT NULL,
  answered INTEGER
)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS requests_who ON requests (who)';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => Math.floor(Date.now() / 1000);
const WHO = /^[A-Za-z0-9_-]{16,40}$/;

// Runs a statement, creating the table the first time (no manual migration needed).
async function run(env, build) {
  try {
    return await build();
  } catch (err) {
    if (!/no such table/i.test(String(err?.message))) throw err;
    await env.DB.batch([env.DB.prepare(CREATE), env.DB.prepare(INDEX)]);
    return build();
  }
}

async function body(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw fail(403, 'Bad origin');
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw fail(415, 'Expected JSON');
  const text = await request.text();
  if (text.length > 6000) throw fail(413, 'Request too large');
  try { return JSON.parse(text); } catch { throw fail(400, 'Invalid JSON'); }
}

/** Cleans a new request; throws a 400 with a readable message when something is off. */
export function cleanRequest(b) {
  const who = String(b?.who || '');
  const kind = KINDS.indexOf(String(b?.kind || ''));
  const anime = String(b?.anime || '').trim().slice(0, 120);
  const message = String(b?.message || '').trim();
  if (!WHO.test(who)) throw fail(400, 'Invalid request id');
  if (kind < 0) throw fail(400, 'Pick what it is about');
  if (kind === 0 && !anime) throw fail(400, 'Which anime should we add?');
  if (message.length < (kind === 0 ? 0 : 5)) throw fail(400, 'Tell us a little more (at least 5 characters)');
  if (message.length > 1000) throw fail(400, 'Please keep it under 1,000 characters');
  return { who, kind, anime: anime || null, message: message || '(no message)' };
}

async function create(request, env) {
  const r = cleanRequest(await body(request));
  if (env.REQUEST_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REQUEST_LIMITER.limit({ key: ip }).catch(() => ({ success: true }));
    if (!success) throw fail(429, 'That was a lot of messages. Wait a minute and try again.');
  }
  const user = await currentUser(request, env).catch(() => null);
  await run(env, () => env.DB.prepare(
    'INSERT INTO requests (who, user_id, kind, anime, message, created) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(r.who, user?.id ?? null, r.kind, r.anime, r.message, now()).run());
  // Keep the table bounded: old answered requests go, and the oldest go past the cap.
  if (Math.random() < 0.05) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM requests WHERE answered IS NOT NULL AND answered < ?').bind(now() - KEEP_ANSWERED_DAYS * 86400),
      env.DB.prepare('DELETE FROM requests WHERE id NOT IN (SELECT id FROM requests ORDER BY id DESC LIMIT ?)').bind(MAX_ROWS),
    ]).catch(() => {});
  }
  return json({ ok: true }, 201);
}

async function mine(request, env, url) {
  const who = url.searchParams.get('who') || '';
  if (!WHO.test(who)) throw fail(400, 'Invalid request id');
  const user = await currentUser(request, env).catch(() => null);
  const { results } = await run(env, () => env.DB.prepare(
    `SELECT id, kind, anime, message, answer, created, answered FROM requests
     WHERE who = ? OR (user_id IS NOT NULL AND user_id = ?) ORDER BY id DESC LIMIT 30`,
  ).bind(who, user?.id ?? -1).all());
  return json({ requests: results.map((r) => ({ ...r, kind: KINDS[r.kind] || 'other' })) });
}

// ---------- admin ----------
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function requireAdmin(request, env) {
  const key = String(env.ADMIN_KEY || '');
  if (key.length < 16) throw fail(503, 'The admin page is off: set the ADMIN_KEY secret (16+ characters) in Cloudflare.');
  const given = String(request.headers.get('X-Admin-Key') || '');
  if (!equal(given, key)) {
    if (env.LOGIN_LIMITER?.limit) {
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const { success } = await env.LOGIN_LIMITER.limit({ key: 'admin:' + ip }).catch(() => ({ success: true }));
      if (!success) throw fail(429, 'Too many attempts. Wait a minute.');
    }
    throw fail(401, 'Wrong admin key');
  }
}

async function adminList(env) {
  const { results } = await run(env, () => env.DB.prepare(
    `SELECT id, kind, anime, message, answer, created, answered FROM requests
     ORDER BY (answer IS NOT NULL), id DESC LIMIT 200`,
  ).all());
  // Last 7 days of "didn't play" reports per server and reason, if the reports table exists.
  let reports = [];
  try {
    ({ results: reports } = await env.DB.prepare(
      `SELECT provider, cat, reason, SUM(n) AS n FROM reports WHERE day > ? GROUP BY provider, cat, reason ORDER BY n DESC`,
    ).bind(Math.floor(Date.now() / 86400000) - 7).all());
  } catch { /* no reports yet */ }
  const notice = await currentNotice(env).catch(() => null);
  const [errors, demoted] = await Promise.all([recentErrors(env), demotedList(env)]);
  return json({ requests: results.map((r) => ({ ...r, kind: KINDS[r.kind] || 'other' })), reports, notice, errors, demoted });
}

export async function handleRequests(ctx, parts) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  try {
    if (!env.DB) throw fail(503, 'Requests need the D1 database binding "DB".');
    const [area, action] = parts;
    if (area === 'requests' && !action) {
      if (request.method === 'POST') return await create(request, env);
      if (request.method === 'GET') return await mine(request, env, url);
    }
    if (area === 'admin') {
      await requireAdmin(request, env);
      if (action === 'requests' && request.method === 'GET') return await adminList(env);
      if (action === 'answer' && request.method === 'POST') {
        const b = await body(request);
        const answer = String(b.answer || '').trim().slice(0, 2000);
        if (!Number.isInteger(b.id) || !answer) throw fail(400, 'Need an id and an answer');
        await run(env, () => env.DB.prepare('UPDATE requests SET answer = ?, answered = ? WHERE id = ?').bind(answer, now(), b.id).run());
        return json({ ok: true });
      }
      if (action === 'undemote' && request.method === 'POST') {
        await clearDemotion(env, await body(request));
        return json({ ok: true });
      }
      if (action === 'notice' && request.method === 'POST') {
        return json({ notice: await setNotice(env, await body(request)) });
      }
      if (action === 'delete' && request.method === 'POST') {
        const b = await body(request);
        if (!Number.isInteger(b.id)) throw fail(400, 'Need an id');
        await run(env, () => env.DB.prepare('DELETE FROM requests WHERE id = ?').bind(b.id).run());
        return json({ ok: true });
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json({ error: status === 500 ? 'Internal error' : err.message }, status);
  }
}
