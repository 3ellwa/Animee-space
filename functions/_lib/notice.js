// A short notice from the site owner (maintenance, a server having trouble …), shown as a
// banner on every page until it expires or the visitor closes it. Set from /admin.
//
//   GET  /api/notice                              -> { notice: { id, text, level, link } | null }
//   POST /api/admin/notice (X-Admin-Key) { text, level?, link?, hours? }   empty text clears it
//
// One row per site (each site has its own database). Kept in memory for a minute, so the
// banner check costs almost nothing.

const CREATE = `CREATE TABLE IF NOT EXISTS notice (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  text    TEXT    NOT NULL,
  level   TEXT    NOT NULL,
  link    TEXT,
  created INTEGER NOT NULL,
  until   INTEGER
)`;
const LEVELS = ['info', 'warn'];
const MEMO_MS = 60 * 1000;
const memo = new Map(); // site -> { value, expires }
const fail = (status, message) => Object.assign(new Error(message), { status });
export function resetNoticeCache() { memo.clear(); }

/** Cleans what the admin typed; throws a 400 when something is off. Empty text = clear. */
export function cleanNotice(b) {
  const text = String(b?.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length > 280) throw fail(400, 'Keep the notice under 280 characters.');
  const level = LEVELS.includes(b?.level) ? b.level : 'info';
  let link = String(b?.link ?? '').trim();
  if (link && !/^\/(?!\/)[^\s]*$/.test(link) && !/^https:\/\/[^\s]+$/.test(link)) throw fail(400, 'The link must start with / or https://');
  if (link.length > 300) throw fail(400, 'The link is too long.');
  const hours = Number(b?.hours);
  const until = Number.isFinite(hours) && hours > 0 ? Math.floor(Date.now() / 1000) + Math.round(Math.min(hours, 24 * 90) * 3600) : null;
  return { text, level, link: link || null, until };
}

async function read(env) {
  try {
    return await env.DB.prepare('SELECT text, level, link, created, until FROM notice WHERE id = 1').first();
  } catch (err) {
    if (/no such table/i.test(String(err?.message))) return null;
    throw err;
  }
}

/** The notice to show now, or null. */
export async function currentNotice(env) {
  if (!env?.DB) return null;
  const site = env.SITE || 'animee';
  const hit = memo.get(site);
  if (hit && hit.expires > Date.now()) return hit.value;
  const row = await read(env).catch(() => null);
  const live = row && (!row.until || row.until > Date.now() / 1000);
  const value = live ? { id: String(row.created), text: row.text, level: row.level, link: row.link || null, until: row.until || null } : null;
  memo.set(site, { value, expires: Date.now() + MEMO_MS });
  return value;
}

export async function setNotice(env, body) {
  const notice = cleanNotice(body);
  await env.DB.prepare(CREATE).run();
  if (!notice) {
    await env.DB.prepare('DELETE FROM notice WHERE id = 1').run();
  } else {
    await env.DB.prepare(
      `INSERT INTO notice (id, text, level, link, created, until) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET text = excluded.text, level = excluded.level, link = excluded.link, created = excluded.created, until = excluded.until`,
    ).bind(notice.text, notice.level, notice.link, Math.floor(Date.now() / 1000), notice.until).run();
  }
  memo.delete(env.SITE || 'animee');
  return currentNotice(env);
}

export async function handleNotice(ctx) {
  const notice = await currentNotice(ctx.env).catch(() => null);
  return new Response(JSON.stringify({ notice }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}
