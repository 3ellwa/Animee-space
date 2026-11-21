// /api/auth/* and /api/me/* — accounts and library sync.
//
//   POST /api/auth/register   { username, password }
//   POST /api/auth/login      { username, password }
//   POST /api/auth/logout
//   POST /api/auth/logout-all            (signs out every device)
//   GET  /api/auth/me                    -> { user } or { user: null }
//   GET  /api/me/library                 -> { rows, prefs, now }
//   POST /api/me/sync         { rows: [...], prefs? }  -> { rows (merged), prefs, now }
//   GET  /api/me/calendar                -> { url } private airing-calendar feed (calendar.js)
//
// A row is { a, s, ep, t, d, w, u } — see migrations/0001_accounts.sql.

import { hashPassword, verifyPassword, sessionCookie, clearCookie, currentUser, calendarToken } from './auth.js';

const MAX_ROWS_PER_USER = 5000;
const MAX_ROWS_PER_PUSH = 200;
const MAX_BITSET_CHARS = 1400; // ~8,000 episodes

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => Math.floor(Date.now() / 1000);

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.includes('application/json')) throw fail(415, 'Expected JSON'); // also blocks cross-site form posts
  const text = await request.text();
  if (text.length > 100000) throw fail(413, 'Request too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw fail(400, 'Invalid JSON'); }
}

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw fail(403, 'Bad origin');
}

// ---------- bitsets (watched episodes) ----------
function bitsDecode(b64) {
  if (!b64) return new Uint8Array(0);
  try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return new Uint8Array(0); }
}
function bitsEncode(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--; // trim trailing zero bytes
  if (!end) return null;
  let s = '';
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function bitsOr(a, b) {
  const x = bitsDecode(a), y = bitsDecode(b);
  const out = new Uint8Array(Math.max(x.length, y.length));
  for (let i = 0; i < out.length; i++) out[i] = (x[i] || 0) | (y[i] || 0);
  return bitsEncode(out);
}

// ---------- validation + merge ----------
const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : min;
};

// s packs the list status in the low 3 bits (0 none, 1 watching, 2 planning, 3 completed,
// 4 on hold, 5 dropped, 6 not interested), a favourite flag (8), and the show's own audio
// choice: 16 = chosen, 32 = dub.
const FLAGS = 8 | 16 | 32;
export function cleanStatus(value) {
  const s = int(value, 0, 63);
  const status = s & 7;
  return (status <= 6 ? status : 0) | (s & FLAGS);
}

function cleanRow(r) {
  const a = String(r?.a ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(a)) return null;
  const w = typeof r.w === 'string' && r.w.length <= MAX_BITSET_CHARS && /^[A-Za-z0-9+/]*={0,2}$/.test(r.w) ? r.w : null;
  return {
    a,
    s: cleanStatus(r.s),
    ep: int(r.ep, 0, 100000),
    t: int(r.t, 0, 86400),
    d: int(r.d, 0, 86400),
    w: w ? bitsEncode(bitsDecode(w)) : null,
    u: int(r.u, 0, now() + 60),
  };
}

// Newest change wins for status/progress; watched episodes are always combined
function merge(existing, incoming) {
  if (!existing) return incoming;
  const newer = incoming.u >= existing.u ? incoming : existing;
  return { a: existing.a, s: newer.s, ep: newer.ep, t: newer.t, d: newer.d, w: bitsOr(existing.w, incoming.w), u: Math.max(existing.u, incoming.u) };
}
const isEmpty = (r) => !r.s && !r.ep && !r.w;
const same = (x, y) => x && y && x.s === y.s && x.ep === y.ep && x.t === y.t && x.d === y.d && (x.w || null) === (y.w || null) && x.u === y.u;

// ---------- rate limits ----------
// Workers' rate limiting bindings (wrangler.toml [[ratelimits]]): counters live at the edge,
// nothing is stored in D1. Sign-in is limited per address and per username, so guessing one
// account's password from many addresses is capped too. Missing bindings (tests) mean no limit.
async function limit(binding, keys) {
  if (!binding?.limit) return;
  for (const key of keys) {
    const { success } = await binding.limit({ key }).catch(() => ({ success: true }));
    if (!success) throw Object.assign(fail(429, 'Too many attempts. Wait a minute and try again.'), { retryAfter: 60 });
  }
}
const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'local';

// ---------- handlers ----------
const USERNAME = /^[a-z0-9_]{3,20}$/;

async function register(request, env) {
  const body = await readBody(request);
  const name = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!USERNAME.test(name)) throw fail(400, 'Username must be 3-20 characters: letters, numbers or _');
  if (password.length < 8 || password.length > 128) throw fail(400, 'Password must be at least 8 characters');
  await limit(env.REGISTER_LIMITER, ['reg:' + clientIp(request)]);

  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE name = ?').bind(name).first();
  if (exists) throw fail(409, 'That username is taken');

  const pass = await hashPassword(password);
  const user = await env.DB.prepare('INSERT INTO users (name, pass, created) VALUES (?, ?, ?) RETURNING id, name, ver, prefs')
    .bind(name, pass, now()).first();
  return json({ user: { id: user.id, name: user.name } }, 201, { 'Set-Cookie': await sessionCookie(env, user) });
}

async function login(request, env) {
  const body = await readBody(request);
  const name = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  await limit(env.LOGIN_LIMITER, ['ip:' + clientIp(request), ...(USERNAME.test(name) ? ['user:' + name] : [])]);
  const user = USERNAME.test(name)
    ? await env.DB.prepare('SELECT id, name, pass, ver, prefs FROM users WHERE name = ?').bind(name).first()
    : null;
  // always run a hash so response time doesn't reveal which usernames exist
  const ok = user ? await verifyPassword(password, user.pass) : (await hashPassword(password), false);
  if (!ok) throw fail(401, 'Wrong username or password');
  return json({ user: { id: user.id, name: user.name } }, 200, { 'Set-Cookie': await sessionCookie(env, user) });
}

async function pull(env, user) {
  const { results } = await env.DB.prepare('SELECT anime_id AS a, s, ep, t, d, w, u FROM library WHERE user_id = ?')
    .bind(user.id).all();
  return { rows: results.map(r => ({ ...r, a: String(r.a) })), prefs: user.prefs, now: now() };
}

async function push(request, env, user) {
  const body = await readBody(request);
  const incoming = (Array.isArray(body.rows) ? body.rows : []).slice(0, MAX_ROWS_PER_PUSH).map(cleanRow).filter(Boolean);
  const stmts = [];

  if (Number.isInteger(body.prefs) && body.prefs >= 0 && body.prefs < 16 && body.prefs !== user.prefs) {
    stmts.push(env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?').bind(body.prefs, user.id));
    user.prefs = body.prefs;
  }

  // load the rows we're about to touch (D1 allows up to 100 bound params per query)
  const existing = new Map();
  const ids = [...new Set(incoming.map((r) => r.a))];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT anime_id AS a, s, ep, t, d, w, u FROM library WHERE user_id = ? AND anime_id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(user.id, ...chunk).all();
    for (const r of results) existing.set(String(r.a), { ...r, a: String(r.a) });
  }

  const newCount = ids.filter((id) => !existing.has(id)).length;
  if (newCount) {
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM library WHERE user_id = ?').bind(user.id).first();
    if (n + newCount > MAX_ROWS_PER_USER) throw fail(413, 'Library is full');
  }

  const merged = new Map();
  for (const row of incoming) {
    const before = merged.get(row.a) || existing.get(row.a) || null;
    merged.set(row.a, merge(before, row));
  }

  const out = [];
  for (const [a, row] of merged) {
    const before = existing.get(a);
    if (isEmpty(row)) {
      if (before) stmts.push(env.DB.prepare('DELETE FROM library WHERE user_id = ? AND anime_id = ?').bind(user.id, a));
      out.push({ ...row, deleted: true });
      continue;
    }
    if (!same(before, row)) {
      stmts.push(env.DB.prepare(
        `INSERT INTO library (user_id, anime_id, s, ep, t, d, w, u) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, anime_id) DO UPDATE SET s = excluded.s, ep = excluded.ep, t = excluded.t, d = excluded.d, w = excluded.w, u = excluded.u`,
      ).bind(user.id, a, row.s, row.ep, row.t, row.d, row.w, row.u));
    }
    out.push(row);
  }

  if (stmts.length) await env.DB.batch(stmts);
  return { rows: out, prefs: user.prefs, now: now() };
}

export async function handleAccount(context, parts) {
  const { request, env } = context;
  const [area, action] = parts;
  try {
    if (!env.DB) throw fail(503, 'Accounts need the D1 database binding "DB" (see README).');
    const method = request.method;
    if (method === 'POST') checkOrigin(request);

    if (area === 'auth') {
      if (action === 'register' && method === 'POST') return await register(request, env);
      if (action === 'login' && method === 'POST') return await login(request, env);
      if (action === 'logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
      if (action === 'me' && method === 'GET') {
        const user = await currentUser(request, env);
        return json({ user: user ? { id: user.id, name: user.name } : null });
      }
      if (action === 'logout-all' && method === 'POST') {
        const user = await currentUser(request, env);
        if (user) await env.DB.prepare('UPDATE users SET ver = ver + 1 WHERE id = ?').bind(user.id).run();
        return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
      }
    }

    if (area === 'me') {
      const user = await currentUser(request, env);
      if (!user) throw fail(401, 'Not signed in');
      if (action === 'library' && method === 'GET') return json(await pull(env, user));
      if (action === 'sync' && method === 'POST') return json(await push(request, env, user));
      if (action === 'calendar' && method === 'GET') {
        return json({ url: `${new URL(request.url).origin}/api/cal/${await calendarToken(env, user)}.ics` });
      }
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json({ error: status === 500 ? 'Internal error' : err.message }, status, err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {});
  }
}
