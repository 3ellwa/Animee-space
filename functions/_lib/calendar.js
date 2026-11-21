// GET /api/cal/<token>.ics — a private calendar feed of the airing shows on your Watching and
// Plan to watch lists, one weekly event per show at its Japanese broadcast time.
// Google Calendar, Apple Calendar and Outlook can subscribe to the link; the token is signed
// (see calendarToken in auth.js), so nothing extra is stored. The finished feed is kept in the
// edge cache for 6 hours, so calendar apps polling it cost almost nothing.

import { userFromCalendarToken } from './auth.js';
import * as tenrai from './providers/tenrai.js';
import * as tmdb from './providers/tmdb.js';

const MAX_SHOWS = 25;
const CACHE_SECONDS = 6 * 3600;
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const pad = (n) => String(n).padStart(2, '0');
const escapeText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes are folded (RFC 5545 §3.1).
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let current = '';
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (out.length ? 74 : 75)) { out.push(current); current = ''; }
    current += ch;
  }
  out.push(current);
  return out.join('\r\n ');
}

// First broadcast on or after `from` (a Date for a Tokyo calendar day) on the given weekday.
function firstOnWeekday(from, weekday) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** One VEVENT for a show, or null when it has no usable weekly broadcast slot. */
export function showEvent(anime, origin, now = new Date()) {
  if (!['RELEASING', 'NOT_YET_RELEASED'].includes(anime?.status)) return null;
  const day = String(anime.broadcast?.day || '').toLowerCase().replace(/s$/, '');
  const time = String(anime.broadcast?.time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!(day in DAYS) || !time) return null;
  const weekday = DAYS[day];
  // Tokyo "today", minus four weeks so the last few episodes still show up.
  const tokyoNow = new Date(now.getTime() + 9 * 3600e3);
  let from = new Date(tokyoNow.getTime() - 28 * 86400e3);
  const start = anime.startDate;
  if (start?.year && start?.month && start?.day) {
    const s = new Date(Date.UTC(start.year, start.month - 1, start.day));
    if (s > from) from = s;
  } else if (anime.status === 'NOT_YET_RELEASED') {
    return null; // no start date yet, nothing to put on a calendar
  }
  const first = firstOnWeekday(from, weekday);
  const stamp = `${first.getUTCFullYear()}${pad(first.getUTCMonth() + 1)}${pad(first.getUTCDate())}T${pad(time[1])}${pad(time[2])}00`;
  const minutes = Math.min(Math.max(Number(anime.duration) || 24, 5), 180);
  const url = `${origin}/anime/${anime.id}`;
  const lines = [
    'BEGIN:VEVENT',
    `UID:animee-${anime.id}@animee.space`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`,
    `DTSTART;TZID=Asia/Tokyo:${stamp}`,
    `DURATION:PT${minutes}M`,
    `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAY[weekday]}`,
    `SUMMARY:${escapeText(`${anime.title} · new episode`)}`,
    `DESCRIPTION:${escapeText(`New episode of ${anime.title} (Japanese broadcast time). Watch: ${url}`)}`,
    `URL:${url}`,
    'END:VEVENT',
  ];
  return lines;
}

export function buildCalendar(shows, origin, now = new Date()) {
  const events = shows.map((a) => showEvent(a, origin, now)).filter(Boolean).flat();
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//animee space//airing calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:animee: my airing shows',
    'X-PUBLISHED-TTL:PT6H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Tokyo',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900',
    'TZOFFSETTO:+0900',
    'TZNAME:JST',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export async function handleCalendar(ctx, file) {
  const { request, env } = ctx;
  const plain = (text, status) => new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return plain('Method not allowed', 405);
  if (!env.DB) return plain('Calendar needs the D1 database binding "DB".', 503);
  const token = String(file || '').replace(/\.ics$/, '');
  const url = new URL(request.url);

  const cache = globalThis.caches?.default;
  const key = new Request(`${url.origin}/api/cal/${token}.ics?__v=1`, { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }

  const user = await userFromCalendarToken(env, token);
  if (!user) return plain('This calendar link is no longer valid. Get a new one from your account page.', 404);

  const { results } = await env.DB.prepare(
    'SELECT anime_id AS a FROM library WHERE user_id = ? AND (s & 7) IN (1, 2) ORDER BY (s & 7), u DESC LIMIT ?',
  ).bind(user.id, MAX_SHOWS * 2).all();
  const shows = [];
  for (const row of results) {
    if (shows.length >= MAX_SHOWS) break;
    try {
      // cinemee titles come from TMDB, which has no weekly broadcast slot, so they add no events.
      if (env.SITE === 'cinemee') tmdb.useToken(env);
      const anime = await (env.SITE === 'cinemee' ? tmdb : tenrai).getAnime(String(row.a));
      if (anime.status === 'RELEASING' || anime.status === 'NOT_YET_RELEASED') shows.push(anime);
    } catch { /* skip shows that can't be loaded right now */ }
  }

  const response = new Response(buildCalendar(shows, url.origin), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="animee.ics"',
      'Cache-Control': 'private, max-age=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
  if (cache) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    const put = cache.put(key, stored).catch(() => {});
    if (ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return response;
}
