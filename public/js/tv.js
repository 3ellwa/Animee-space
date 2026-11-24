// TV mode: animee, cinemee and mangee in a smart TV's own browser, driven by the remote
// (Samsung Tizen, LG webOS, Android TV / Google TV, Fire TV, Hisense VIDAA, Philips, Sony...).
//
// - Arrow keys move focus to the nearest button, link or field in that direction (spatial
//   navigation), scrolling rows and the page along with it.
// - OK clicks. Back goes back (or leaves full screen / closes the menu first).
// - Play/pause, fast-forward/rewind and channel up/down work on the watch page.
// - The page gets html.tv: big focus rings, bigger text, no hover-only extras (style.css).
//
// It switches on by itself for TV browsers. ?tv=1 turns it on in any browser (handy for testing
// with a keyboard), ?tv=0 turns it off; the choice is remembered in this browser.

const KEY = 'animee-space:tv';
const TV_UA = /\b(smart-?tv|smarttv|tizen|web0s|webos|netcast|hbbtv|bravia|vidaa|hisense|philipstv|nettv|viera|aquos|android tv|googletv|google tv|crkey|aft[a-z]{1,4}\b|fire tv|silk\/.*\bTV|roku|opera tv|tv safari|appletv)/i;

export function detectTv(ua = '', query = '', saved = null) {
  const forced = /(?:^|[?&])tv=([01])\b/.exec(query);
  if (forced) return forced[1] === '1';
  if (saved === '1' || saved === '0') return saved === '1';
  return TV_UA.test(ua);
}

function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(on) { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ } }

let on = false;
export const isTv = () => on;

export function setTv(value) {
  on = Boolean(value);
  save(on);
  document.documentElement.classList.toggle('tv', on);
}

// ---------- remote keys ----------
// Names first (modern browsers), then the key codes TVs actually send.
const BACK_CODES = new Set([461 /* webOS */, 10009 /* Tizen */, 8 /* some remotes send Backspace */, 27]);
// One ⏯ button (Samsung, Android TV...) toggles; LG has separate Play, Pause and Stop buttons.
const PLAY_PAUSE = new Set([179 /* MediaPlayPause */, 10252 /* Tizen */, 463]);
const PLAY = new Set([415 /* LG webOS, HbbTV */, 250]);
const PAUSE = new Set([19 /* LG webOS, HbbTV */]);
const STOP = new Set([413 /* LG webOS */, 178 /* MediaStop */]);
const FAST_FORWARD = new Set([417, 228]);
const REWIND = new Set([412, 227]);
const CHANNEL_UP = new Set([427, 33]);
const CHANNEL_DOWN = new Set([428, 34]);

export function keyKind(e) {
  const k = e.key;
  if (k === 'ArrowUp' || k === 'Up') return 'up';
  if (k === 'ArrowDown' || k === 'Down') return 'down';
  if (k === 'ArrowLeft' || k === 'Left') return 'left';
  if (k === 'ArrowRight' || k === 'Right') return 'right';
  if (k === 'Enter' || e.keyCode === 13) return 'ok';
  if (k === 'GoBack' || k === 'BrowserBack' || k === 'Escape' || k === 'Backspace' || BACK_CODES.has(e.keyCode)) return 'back';
  if (k === 'MediaPlay' || k === 'Play' || PLAY.has(e.keyCode)) return 'play';
  if (k === 'MediaPause' || k === 'Pause' || PAUSE.has(e.keyCode)) return 'pause';
  if (k === 'MediaStop' || STOP.has(e.keyCode)) return 'pause';
  if (k === 'MediaPlayPause' || PLAY_PAUSE.has(e.keyCode)) return 'playpause';
  if (k === 'MediaFastForward' || FAST_FORWARD.has(e.keyCode)) return 'forward';
  if (k === 'MediaRewind' || REWIND.has(e.keyCode)) return 'rewind';
  if (k === 'ChannelUp' || k === 'PageUp' || CHANNEL_UP.has(e.keyCode)) return 'chup';
  if (k === 'ChannelDown' || k === 'PageDown' || CHANNEL_DOWN.has(e.keyCode)) return 'chdown';
  return '';
}

// ---------- spatial navigation ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function visible(el) {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
}

/** Everything the remote can land on, inside the open menu when there is one. */
export function candidates(root = document) {
  const menu = document.querySelector('#nav-links.open');
  const scope = menu || root;
  return [...scope.querySelectorAll(FOCUSABLE)].filter((el) => el.tagName !== 'IFRAME' && visible(el));
}

/**
 * The best element to move to from rect `from` in direction `dir`, among `rects`
 * ([{ el, r }]). Pure geometry, so it can be tested: prefer things straight ahead (overlapping
 * on the other axis), then the nearest row or column, then the best aligned.
 */
export function pickNext(from, dir, rects) {
  const fc = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  let best = null, bestScore = Infinity;
  for (const { el, r } of rects) {
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    let main, side, overlap;
    if (dir === 'down') { main = r.top - from.bottom; side = Math.abs(c.x - fc.x); overlap = r.left < from.right && r.right > from.left; if (c.y <= fc.y + 1) continue; }
    else if (dir === 'up') { main = from.top - r.bottom; side = Math.abs(c.x - fc.x); overlap = r.left < from.right && r.right > from.left; if (c.y >= fc.y - 1) continue; }
    // Left/right stay on the same line: jumping to another row sideways feels random on a remote.
    else if (dir === 'right') { main = r.left - from.right; side = Math.abs(c.y - fc.y); overlap = r.top < from.bottom && r.bottom > from.top; if (c.x <= fc.x + 1 || !overlap) continue; }
    else { main = from.left - r.right; side = Math.abs(c.y - fc.y); overlap = r.top < from.bottom && r.bottom > from.top; if (c.x >= fc.x - 1 || !overlap) continue; }
    // Things in line come first; among them the nearest row/column wins, then the most aligned.
    const score = (overlap ? 0 : 1e6) + Math.max(0, main) * 4 + side;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

function focusEl(el) {
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
  // Rows scroll sideways to the card; the page keeps the focused thing comfortably in view.
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

function firstInView() {
  const list = candidates();
  const inView = list.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
  // Start on the page's main button (Watch, Continue...) or the player, else the first thing in
  // the page itself rather than the nav bar.
  const main = inView.find((el) => el.closest('#app') && el.matches('.player, .btn.primary'))
    || inView.find((el) => el.closest('#app')) || inView[0] || list[0];
  return main || null;
}

export function move(dir) {
  const current = document.activeElement;
  if (!current || current === document.body || !visible(current)) {
    const start = firstInView();
    if (start) focusEl(start);
    return Boolean(start);
  }
  const from = current.getBoundingClientRect();
  const rects = candidates().filter((el) => el !== current && !el.contains(current)).map((el) => ({ el, r: el.getBoundingClientRect() }));
  const next = pickNext(from, dir, rects);
  if (next) { focusEl(next); return true; }
  // Nothing further that way: scroll the page a bit so long text can still be read.
  if (dir === 'up' || dir === 'down') { scrollBy({ top: (dir === 'down' ? 1 : -1) * innerHeight * 0.6, behavior: 'smooth' }); return true; }
  return false;
}

// ---------- the watch page hooks in here ----------
// { playPause(), setPaused(bool), seekBy(s), next(), prev(), playerBox } while a watch page is open.
let media = null;
export function setMedia(handlers) { media = handlers; return () => { if (media === handlers) media = null; }; }

function back() {
  if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return true; }
  const menu = document.querySelector('#nav-links.open');
  if (menu) { menu.classList.remove('open'); document.getElementById('menu-btn')?.focus(); return true; }
  // On the home page Back is left to the TV, so it can close the browser.
  if (location.pathname === '/' || history.length <= 1) return false;
  history.back();
  return true;
}

function onKey(e) {
  if (!on || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const kind = keyKind(e);
  if (!kind) return;
  const t = e.target;
  const typing = t.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"]');
  const inPlayer = media?.playerBox && t.closest?.('.player') === media.playerBox;

  if (kind === 'back') {
    // Backspace and Escape still edit / clear text while typing.
    if (typing && (e.key === 'Backspace' || e.key === 'Escape')) { if (e.key === 'Escape') t.blur(); return; }
    if (back()) e.preventDefault();
    return;
  }
  if (kind === 'playpause' && media) { e.preventDefault(); media.playPause(); return; }
  if ((kind === 'play' || kind === 'pause') && media) { e.preventDefault(); media.setPaused(kind === 'pause'); return; }
  if ((kind === 'forward' || kind === 'rewind') && media) { e.preventDefault(); media.seekBy(kind === 'forward' ? 30 : -30); return; }
  if ((kind === 'chup' || kind === 'chdown') && media && !typing) { e.preventDefault(); (kind === 'chup' ? media.next : media.prev)(); return; }
  if (kind === 'ok') {
    if (inPlayer) { e.preventDefault(); media.playPause(); return; }
    // Checkboxes, radios and focusable non-buttons click on OK too (only Space does by default).
    if (t.matches?.('input[type="checkbox"], input[type="radio"], summary, [tabindex]:not(a):not(button):not(input):not(select):not(textarea)')) { e.preventDefault(); t.click(); }
    return;
  }
  // Arrows. While typing, left/right move the caret; up/down leave the field.
  if (typing && (kind === 'left' || kind === 'right')) return;
  if (t.tagName === 'SELECT') return; // its own list
  // On the player, left/right seek (the watch page handles those), up/down leave it.
  if (inPlayer && (kind === 'left' || kind === 'right')) return;
  if (e.target.matches?.('input[type="range"]') && (kind === 'left' || kind === 'right')) return;
  if (move(kind)) e.preventDefault();
}

export function initTv() {
  on = detectTv(navigator.userAgent, location.search, readSaved());
  if (/(?:^|[?&])tv=[01]\b/.test(location.search)) save(on);
  document.documentElement.classList.toggle('tv', on);
  // Capture phase: runs before the page's own shortcuts, so arrows move focus first.
  addEventListener('keydown', onKey, true);
  // After every page change, put focus somewhere useful so the remote works straight away.
  addEventListener('animee:navigate', () => {
    if (!on) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (!a || a === document.body || !document.contains(a) || !visible(a)) {
        const start = firstInView();
        if (start) try { start.focus({ preventScroll: true }); } catch { start.focus(); }
      }
    }, 400);
  });
}
