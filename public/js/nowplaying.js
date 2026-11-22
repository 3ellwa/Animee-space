// "Now playing": what you're watching or reading right now, as a small JSON block in the page
// (<script id="now-playing" type="application/json">). Discord Rich Presence tools such as
// PreMiD read it to show "Watching animee · Frieren · Episode 5" on your Discord profile
// (integrations/premid/ has the presence). Nothing leaves the page: it's only for local
// extensions you installed yourself.
//
// Shape: { site, kind: 'watching'|'reading', title, episode, episodeTitle, season, number,
//          time, duration (seconds, or pages when reading), paused (true/false/null = unknown),
//          at (ms when time was read), cover, url }

import { SITE } from './site.js';

const ID = 'now-playing';
const abs = (u) => { try { return u ? new URL(u, location.origin).href : ''; } catch { return ''; } };

export function setNowPlaying(info) {
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('script');
    el.id = ID;
    el.type = 'application/json';
    document.head.appendChild(el);
  }
  const data = {
    site: SITE,
    kind: info.kind || 'watching',
    title: info.title || '',
    episode: info.episode || '',
    episodeTitle: info.episodeTitle || '',
    season: info.season ?? null,
    number: info.number ?? null,
    time: Number.isFinite(info.time) ? Math.round(info.time) : null,
    duration: Number.isFinite(info.duration) && info.duration > 0 ? Math.round(info.duration) : null,
    paused: typeof info.paused === 'boolean' ? info.paused : null,
    at: Date.now(),
    cover: abs(info.cover),
    url: abs(info.url),
  };
  el.textContent = JSON.stringify(data);
}

export function clearNowPlaying() {
  document.getElementById(ID)?.remove();
}
