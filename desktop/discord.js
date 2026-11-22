// Discord presence straight from the app (no PreMiD needed). Talks to the Discord desktop
// app on this computer; if Discord isn't running it quietly tries again every 20 seconds.
//
// The Discord application "animee" (id below) owns the presence; its Rich Presence art isn't
// needed because images are sent as links.

const { Client } = require('@xhayper/discord-rpc');

const CLIENT_ID = '1574094254597341214';
const WATCHING = 3; // Discord activity type "Watching"
const SHOW_DETAILS = 2; // the status line shows the title instead of the app's name
const LOGOS = {
  animee: 'https://animee.space/icons/icon-512.png',
  cinemee: 'https://cinemee.animee.space/icons/icon-512.png',
  mangee: 'https://mangee.animee.space/icons/icon-512.png',
};

let client = null;
let ready = false;
let retry = null;
let pending = undefined; // the latest thing to show (null = clear)
const browsingSince = new Date();

function start() {
  if (client) return;
  client = new Client({ clientId: CLIENT_ID, transport: { type: 'ipc' } });
  client.on('ready', () => { ready = true; flush(); });
  client.on('disconnected', () => { ready = false; schedule(); });
  connect();
}
function connect() {
  client.login().catch(() => { ready = false; schedule(); });
}
function schedule() {
  clearTimeout(retry);
  retry = setTimeout(() => { if (client && !ready) connect(); }, 20000);
}
function stop() {
  clearTimeout(retry);
  try { client?.destroy(); } catch { /* ignore */ }
  client = null;
  ready = false;
}

/** Turn the page's "now playing" block into a Discord activity. */
function toActivity(now) {
  const site = ['animee', 'cinemee', 'mangee'].includes(now?.site) ? now.site : 'animee';
  if (!now || !now.title) {
    return { type: WATCHING, details: `Browsing ${site}`, largeImageKey: LOGOS[site], largeImageText: 'my space', startTimestamp: browsingSince };
  }
  const reading = now.kind === 'reading';
  const a = {
    type: WATCHING,
    statusDisplayType: SHOW_DETAILS,
    details: clip(now.title),
    largeImageKey: /^https:\/\//.test(now.cover) ? now.cover : LOGOS[site],
    largeImageText: clip(`on ${site}`),
    smallImageKey: LOGOS[site],
    smallImageText: site,
  };
  if (reading) {
    a.state = clip([now.episode, now.time && now.duration ? `page ${now.time} of ${now.duration}` : ''].filter(Boolean).join(' · ') || 'Reading');
    a.startTimestamp = browsingSince;
  } else {
    a.state = clip([now.episode, now.episodeTitle].filter(Boolean).join(' · ') || 'Movie');
    // Discord turns "Season 2, Episode 5" into "S2E5" on Watching cards.
    if (now.number && now.episode) a.largeImageText = now.season ? `Season ${now.season}, Episode ${now.number}` : `Episode ${now.number}`;
    if (now.paused) {
      a.state = clip(`${a.state} (paused)`);
    } else if (Number.isFinite(now.time) && now.duration) {
      const position = now.time + (now.paused === false ? (Date.now() - now.at) / 1000 : 0);
      const start = Date.now() - position * 1000;
      a.startTimestamp = new Date(start);
      a.endTimestamp = new Date(start + now.duration * 1000);
    }
  }
  if (/^https:\/\//.test(now.url)) a.buttons = [{ label: reading ? 'Read it on my space' : 'Watch it on my space', url: now.url }];
  return a;
}
// Discord rejects text over 128 characters (and under 2).
function clip(s) {
  s = String(s || '');
  if (s.length < 2) s = s.padEnd(2, ' ');
  return s.length > 128 ? `${s.slice(0, 125)}...` : s;
}

function show(now) { pending = now; flush(); }
function clear() { pending = null; flush(); }
function flush() {
  if (!ready || !client?.user || pending === undefined) return;
  const p = pending === null ? client.user.clearActivity() : client.user.setActivity(toActivity(pending));
  p.catch(() => { /* Discord closed meanwhile: the next update tries again */ });
}

module.exports = { start, stop, show, clear, toActivity };
