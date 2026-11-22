// "Continue on cinemee" on animee, and "Continue on animee" on cinemee. Each site has its own
// accounts, so this only works for someone signed in on both: the other site's home page asks
// this one, with this site's own login cookie (both are the same site, animee.space, so the
// browser sends it), for the last few things being watched here.
//
//   GET /api/me/continue   (from the sibling site only, with credentials) -> { site, items }
//
// Only the sibling origin gets an answer it can read (CORS with credentials, exact origin).

import { currentUser } from './auth.js';
import * as tenrai from './providers/tenrai.js';
import * as tmdb from './providers/tmdb.js';
import * as mangadex from './providers/mangadex.js';

/** The other site's origin for a request URL: animee.space <-> cinemee.animee.space. */
export function siblingOrigin(requestUrl) {
  const url = new URL(requestUrl);
  const host = url.host.startsWith('cinemee.') ? url.host.slice('cinemee.'.length) : `cinemee.${url.host}`;
  return `${url.protocol}//${host}`;
}
/** Every sister site's origin except this one (animee, cinemee and mangee, same scheme and port). */
export function sisterOrigins(requestUrl) {
  const url = new URL(requestUrl);
  const base = url.host.replace(/^(cinemee|mangee)\./, '');
  return [base, `cinemee.${base}`, `mangee.${base}`].filter((h) => h !== url.host).map((h) => `${url.protocol}//${h}`);
}

export async function handleContinue(ctx) {
  const { request, env } = ctx;
  const origin = request.headers.get('Origin') || '';
  const allowed = Boolean(origin) && sisterOrigins(request.url).includes(origin);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    Vary: 'Origin',
    ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {}),
  };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (!allowed) return reply({ error: 'Only for the sibling site' }, 403);
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const site = env.SITE === 'cinemee' || env.SITE === 'mangee' ? env.SITE : 'animee';
  if (!env.DB) return reply({ site, items: [] });
  const user = await currentUser(request, env).catch(() => null);
  if (!user) return reply({ site, items: [], signedIn: false });

  const { results } = await env.DB.prepare(
    'SELECT anime_id, ep, t, d, u FROM library WHERE user_id = ? AND ep > 0 ORDER BY u DESC LIMIT 8',
  ).bind(user.id).all();
  if (site === 'cinemee') tmdb.useToken(env);
  if (site === 'mangee') mangadex.useEnv(env);
  const cat = site === 'cinemee' ? tmdb : site === 'mangee' ? mangadex : tenrai;
  const items = [];
  for (const row of results || []) {
    if (items.length >= 6) break;
    try {
      const a = await cat.getAnime(String(row.anime_id));
      // A finished movie or a finished last episode isn't "continue" any more.
      const done = row.d > 0 && row.t / row.d > 0.9 && (!a.availableEpisodes || row.ep >= a.availableEpisodes);
      if (done) continue;
      items.push({ id: a.id, title: a.title, cover: a.cover, banner: a.banner, format: a.format, ep: row.ep, time: row.t, duration: row.d, label: a.format === 'MOVIE' ? 'Movie' : site === 'mangee' ? `Page ${row.t + 1}` : `Episode ${row.ep}` });
    } catch { /* skip titles that can't be loaded right now */ }
  }
  return reply({ site, items, signedIn: true });
}
