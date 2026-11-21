// Your own subtitles on cinemee's Atlas server (EmbedMaster). The browser turns an .srt or .vtt
// file into WebVTT and uploads it here; Atlas loads it from our address (its docs require the
// file's server to allow any origin), passed as sub_url[] / sub_label[] on the embed.
//
//   POST /api/subs { vtt }   -> { id, url }   at most 500 KB of WebVTT text, rate-limited
//   GET  /api/subs/<id>.vtt  -> the file (Access-Control-Allow-Origin: *)
//
// Files are kept for 3 days, then deleted; nothing else is stored with them.

const MAX_BYTES = 500 * 1024;
const KEEP_SECONDS = 3 * 86400;
const CREATE = `CREATE TABLE IF NOT EXISTS subs (
  id      TEXT    PRIMARY KEY,
  vtt     TEXT    NOT NULL,
  created INTEGER NOT NULL
) WITHOUT ROWID`;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const now = () => Math.floor(Date.now() / 1000);

/** Accepts WebVTT only (the browser converts .srt first); returns the cleaned text or null. */
export function cleanVtt(text) {
  const vtt = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT[^\n]*\n/.test(vtt) || new TextEncoder().encode(vtt).length > MAX_BYTES) return null;
  if (!/\d{2}:\d{2}[:.,]\d{2}[.,]\d{3}\s+-->\s+/.test(vtt) && !/\d{2}:\d{2}\.\d{3}\s+-->\s+/.test(vtt)) return null;
  // No markup beyond WebVTT's own simple tags.
  return vtt.replace(/<(?!\/?(b|i|u|c|v|lang|ruby|rt)\b)[^>]*>/gi, '');
}

export async function handleSubs(ctx, parts) {
  const { request, env } = ctx;
  if (!env.DB) return json({ error: 'Not set up' }, 503);
  const file = parts[1];
  if (request.method === 'GET' && file) {
    const id = String(file).replace(/\.vtt$/, '');
    if (!/^[A-Za-z0-9]{20}$/.test(id)) return new Response('Not found', { status: 404 });
    const row = await env.DB.prepare('SELECT vtt, created FROM subs WHERE id = ?').bind(id).first().catch(() => null);
    if (!row || row.created < now() - KEEP_SECONDS) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    return new Response(row.vtt, { headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  if (request.method !== 'POST' || file) return json({ error: 'Not found' }, 404);
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Bad origin' }, 403);
  const text = await request.text();
  if (text.length > MAX_BYTES * 2) return json({ error: 'That subtitle file is too big (500 KB at most).' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const vtt = cleanVtt(body?.vtt);
  if (!vtt) return json({ error: 'That doesn’t look like a subtitle file (.srt or .vtt, 500 KB at most).' }, 400);
  if (env.REQUEST_LIMITER?.limit) {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    const { success } = await env.REQUEST_LIMITER.limit({ key: 'subs:' + ip }).catch(() => ({ success: true }));
    if (!success) return json({ error: 'Too many uploads. Wait a minute.' }, 429);
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const id = Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) => letters[n % letters.length]).join('');
  const insert = () => env.DB.prepare('INSERT INTO subs (id, vtt, created) VALUES (?, ?, ?)').bind(id, vtt, now()).run();
  try { await insert(); } catch (err) {
    if (!/no such table/i.test(String(err?.message))) throw err;
    await env.DB.prepare(CREATE).run();
    await insert();
  }
  if (Math.random() < 0.1) await env.DB.prepare('DELETE FROM subs WHERE created < ?').bind(now() - KEEP_SECONDS).run().catch(() => {});
  return json({ id, url: `${new URL(request.url).origin}/api/subs/${id}.vtt` });
}

/** SRT (or VTT) text -> WebVTT, for the browser before upload. Exported for tests. */
export function srtToVtt(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(t)) return t + '\n';
  const body = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/^\d+\n(?=\d{1,2}:\d{2}:\d{2}\.\d{3})/gm, '');
  return `WEBVTT\n\n${body}\n`;
}
