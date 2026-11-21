// Browser pop-ups for new episodes of followed shows (Web Push).
//
//   GET  /api/push/key                                  -> { publicKey } (null when not set up)
//   POST /api/push/subscribe   { endpoint, ids, alerts } -> { ok }   ids: followed MAL ids (max 100)
//   POST /api/push/unsubscribe { endpoint }              -> { ok }
//   GET  /api/push/pending?endpoint=...                  -> { items } what the last pop-up was about
//   POST /api/push/test        { endpoint }              -> { ok }   sends a test pop-up now
//
// Pushes carry no payload (so no message encryption is needed): the service worker wakes up,
// asks /api/push/pending what's new, and shows it. A scheduled run (wrangler.toml [triggers])
// checks a few followed shows at a time for a new aired episode and wakes their followers.
//
// Storage is small: one row per device that turned pop-ups on (its push address), one tiny row
// per followed show per device, and one row per followed show with its last aired count.
// Devices whose push address stops working (404/410) are deleted automatically.
//
// Keys: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY secrets (scripts/setup-push.mjs makes and sets
// them). Without them the feature is off and the settings page says so.

import * as tenrai from './providers/tenrai.js';
import * as megaplay from './providers/megaplay.js';

const MAX_FOLLOWS = 100;
const SHOWS_PER_RUN = 6;        // light enough for the free plan's per-run limits
const SENDS_PER_RUN = 25;
const RECHECK_SECONDS = 30 * 60; // each followed show is looked at about every half hour or so
// Only real browser push services, so the Worker never posts to an arbitrary address.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /^push\.apple\.com$/];

const TABLES = [
  `CREATE TABLE IF NOT EXISTS push_subs (
    id INTEGER PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, alerts INTEGER NOT NULL DEFAULT 0,
    pending TEXT, due INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS push_follows (
    sub_id INTEGER NOT NULL, anime_id INTEGER NOT NULL, PRIMARY KEY (sub_id, anime_id)) WITHOUT ROWID`,
  'CREATE INDEX IF NOT EXISTS push_follows_anime ON push_follows (anime_id)',
  `CREATE TABLE IF NOT EXISTS push_shows (
    anime_id INTEGER PRIMARY KEY, aired INTEGER NOT NULL DEFAULT 0, page INTEGER NOT NULL DEFAULT 1, checked INTEGER NOT NULL DEFAULT 0)`,
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => Math.floor(Date.now() / 1000);

let tablesReady = false;
async function ensureTables(env) {
  if (tablesReady) return;
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  tablesReady = true;
}

export function validEndpoint(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { return null; }
  if (url.protocol !== 'https:' || String(raw).length > 1000) return null;
  return PUSH_HOSTS.some((re) => re.test(url.hostname)) ? url.toString() : null;
}

async function body(request) {
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw fail(403, 'Bad origin');
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw fail(415, 'Expected JSON');
  const text = await request.text();
  if (text.length > 8000) throw fail(413, 'Request too large');
  try { return JSON.parse(text); } catch { throw fail(400, 'Invalid JSON'); }
}

// ---------- VAPID (signed "this push comes from animee") ----------
const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
  },
};
const keysReady = (env) => /^[A-Za-z0-9_-]{80,90}$/.test(env.VAPID_PUBLIC_KEY || '') && /^[A-Za-z0-9_-]{40,46}$/.test(env.VAPID_PRIVATE_KEY || '');

let signingKey = null;
export const resetSigningKey = () => { signingKey = null; }; // tests
export async function vapidHeader(env, endpoint) {
  if (!signingKey) {
    const pub = b64u.decode(env.VAPID_PUBLIC_KEY); // 65 bytes: 0x04 || x || y
    signingKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const enc = (obj) => b64u.encode(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: now() + 12 * 3600, sub: 'https://animee.space' })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Wakes one device. Returns 'ok', 'gone' (delete it) or 'failed' (try again next run).
async function wake(env, endpoint) {
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: await vapidHeader(env, endpoint), TTL: '86400', Urgency: 'normal', 'Content-Length': '0' },
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    return r.ok ? 'ok' : 'failed';
  } catch { return 'failed'; }
}

// ---------- routes ----------
async function subscribe(request, env) {
  const b = await body(request);
  const endpoint = validEndpoint(b.endpoint);
  if (!endpoint) throw fail(400, 'That push address is not from a known browser push service');
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String).filter((id) => /^\d{1,12}$/.test(id)))].slice(0, MAX_FOLLOWS);
  const alerts = [0, 1, 2].includes(b.alerts) ? b.alerts : 0;
  if (env.REQUEST_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REQUEST_LIMITER.limit({ key: 'push:' + ip }).catch(() => ({ success: true }));
    if (!success) throw fail(429, 'Too many changes. Wait a minute.');
  }
  const sub = await env.DB.prepare(
    `INSERT INTO push_subs (endpoint, alerts, created) VALUES (?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET alerts = excluded.alerts RETURNING id`,
  ).bind(endpoint, alerts, now()).first();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM push_follows WHERE sub_id = ?').bind(sub.id),
    ...ids.map((id) => env.DB.prepare('INSERT OR IGNORE INTO push_follows (sub_id, anime_id) VALUES (?, ?)').bind(sub.id, Number(id))),
    ...ids.map((id) => env.DB.prepare('INSERT OR IGNORE INTO push_shows (anime_id) VALUES (?)').bind(Number(id))),
  ]);
  return json({ ok: true, following: ids.length });
}

async function unsubscribe(request, env) {
  const endpoint = validEndpoint((await body(request)).endpoint);
  if (!endpoint) return json({ ok: true });
  const sub = await env.DB.prepare('SELECT id FROM push_subs WHERE endpoint = ?').bind(endpoint).first();
  if (sub) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM push_follows WHERE sub_id = ?').bind(sub.id),
      env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id),
    ]);
  }
  return json({ ok: true });
}

async function pending(env, url) {
  const endpoint = validEndpoint(url.searchParams.get('endpoint'));
  if (!endpoint) return json({ items: [] });
  const sub = await env.DB.prepare('SELECT id, pending FROM push_subs WHERE endpoint = ?').bind(endpoint).first();
  if (!sub) return json({ items: [] });
  let items = [];
  try { items = JSON.parse(sub.pending || '[]'); } catch { /* ignore */ }
  if (items.length) await env.DB.prepare('UPDATE push_subs SET pending = NULL WHERE id = ?').bind(sub.id).run();
  return json({ items });
}

async function test(request, env) {
  const endpoint = validEndpoint((await body(request)).endpoint);
  if (!endpoint) throw fail(400, 'Unknown push address');
  if (env.REQUEST_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REQUEST_LIMITER.limit({ key: 'pushtest:' + ip }).catch(() => ({ success: true }));
    if (!success) throw fail(429, 'Wait a minute before another test.');
  }
  const sub = await env.DB.prepare('SELECT id FROM push_subs WHERE endpoint = ?').bind(endpoint).first();
  if (!sub) throw fail(404, 'Pop-ups are not on for this device');
  await env.DB.prepare('UPDATE push_subs SET pending = ? WHERE id = ?')
    .bind(JSON.stringify([{ test: true, title: 'Pop-ups work ^^.', body: 'New episodes of shows you follow will show up like this.' }]), sub.id).run();
  const result = await wake(env, endpoint);
  if (result === 'gone') await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id).run();
  return json({ ok: result === 'ok', result });
}

export async function handlePush(ctx, parts) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  try {
    const action = parts[1];
    if (action === 'key' && request.method === 'GET') return json({ publicKey: keysReady(env) ? env.VAPID_PUBLIC_KEY : null });
    if (!env.DB) throw fail(503, 'Pop-ups need the D1 database binding "DB".');
    if (!keysReady(env)) throw fail(503, 'Pop-ups are not set up on this server yet.');
    await ensureTables(env);
    if (action === 'subscribe' && request.method === 'POST') return await subscribe(request, env);
    if (action === 'unsubscribe' && request.method === 'POST') return await unsubscribe(request, env);
    if (action === 'pending' && request.method === 'GET') return await pending(env, url);
    if (action === 'test' && request.method === 'POST') return await test(request, env);
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json({ error: status === 500 ? 'Internal error' : err.message }, status);
  }
}

// ---------- scheduled check ----------
// Aired episodes from the last page of the show's episode list (100 per page): one small request.
async function airedCount(id, page) {
  const list = async (p) => tenrai.request(`/anime/${id}/episodes?page=${p}&sfw-strict=true`);
  let payload = await list(page);
  let rows = Array.isArray(payload?.data) ? payload.data : [];
  // A full page means the list may have moved on to the next one.
  while (rows.length >= 100 && payload?.pagination?.has_next_page && page < 30) {
    page++;
    payload = await list(page);
    rows = Array.isArray(payload?.data) ? payload.data : [];
  }
  const perPage = 100;
  return { aired: (page - 1) * perPage + rows.length, page };
}

export async function runPushCheck(env) {
  if (!env.DB || !keysReady(env)) return { skipped: true };
  await ensureTables(env);
  const t = now();
  // 1. Followed shows that haven't been looked at for a while, oldest first.
  const { results: shows } = await env.DB.prepare(
    `SELECT s.anime_id, s.aired, s.page, s.checked FROM push_shows s
     WHERE EXISTS (SELECT 1 FROM push_follows f WHERE f.anime_id = s.anime_id) AND s.checked < ?
     ORDER BY s.checked LIMIT ?`,
  ).bind(t - RECHECK_SECONDS, SHOWS_PER_RUN).all();

  const updates = [];
  let newEpisodes = 0;
  for (const show of shows) {
    let result;
    try { result = await airedCount(show.anime_id, Math.max(1, show.page)); } catch { continue; }
    updates.push(env.DB.prepare('UPDATE push_shows SET aired = ?, page = ?, checked = ? WHERE anime_id = ?')
      .bind(result.aired, result.page, t, show.anime_id));
    // The first look only records where the show is; later looks notify when it moved on.
    if (!show.checked || result.aired <= show.aired) continue;
    newEpisodes++;
    const ep = result.aired;
    let title = `Episode ${ep}`;
    let cover = null;
    try { const a = await tenrai.getAnime(String(show.anime_id)); title = a.title; cover = a.cover; } catch { /* keep the plain title */ }
    let dubOut = null; // only asked when someone wants dub-only alerts
    const { results: subs } = await env.DB.prepare(
      'SELECT s.id, s.alerts, s.pending FROM push_follows f JOIN push_subs s ON s.id = f.sub_id WHERE f.anime_id = ?',
    ).bind(show.anime_id).all();
    for (const sub of subs) {
      if (sub.alerts === 2) {
        if (dubOut === null) dubOut = await megaplay.isAvailable(String(show.anime_id), ep, 'dub').catch(() => false);
        if (!dubOut) continue;
      }
      let items = [];
      try { items = JSON.parse(sub.pending || '[]'); } catch { /* ignore */ }
      items = [{ id: String(show.anime_id), ep, title, cover }, ...items.filter((i) => i.id !== String(show.anime_id))].slice(0, 5);
      updates.push(env.DB.prepare('UPDATE push_subs SET pending = ?, due = 1 WHERE id = ?').bind(JSON.stringify(items), sub.id));
    }
  }
  if (updates.length) await env.DB.batch(updates);

  // 2. Wake devices with something new.
  const { results: due } = await env.DB.prepare('SELECT id, endpoint FROM push_subs WHERE due = 1 LIMIT ?').bind(SENDS_PER_RUN).all();
  const done = [];
  let sent = 0;
  for (const sub of due) {
    const result = await wake(env, sub.endpoint);
    if (result === 'gone') {
      done.push(env.DB.prepare('DELETE FROM push_follows WHERE sub_id = ?').bind(sub.id), env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(sub.id));
    } else if (result === 'ok') {
      sent++;
      done.push(env.DB.prepare('UPDATE push_subs SET due = 0 WHERE id = ?').bind(sub.id));
    }
  }
  if (done.length) await env.DB.batch(done);
  // 3. Shows nobody follows any more.
  await env.DB.prepare('DELETE FROM push_shows WHERE NOT EXISTS (SELECT 1 FROM push_follows f WHERE f.anime_id = push_shows.anime_id)').run();
  return { checked: shows.length, newEpisodes, sent };
}
