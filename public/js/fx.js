// The small things that make the site feel alive: the scroll progress line, the floating nav,
// the lime glow that follows the cursor over cards, "/" to search, and the idle whisper.
// Everything here is decoration: the site works the same without it.

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ---------- scroll progress and floating nav ----------
const nav = document.getElementById('nav');
let scrollQueued = false;
function onScroll() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(() => {
    scrollQueued = false;
    const max = root.scrollHeight - innerHeight;
    root.style.setProperty('--scroll', max > 0 ? Math.min(1, scrollY / max).toFixed(4) : '0');
    nav?.classList.toggle('scrolled', scrollY > 8);
  });
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll, { passive: true });
addEventListener('animee:navigate', () => setTimeout(onScroll, 50));
onScroll();

// ---------- cursor glow on cards ----------
// Sets --mx/--my on the hovered card so the CSS radial glow sits under the pointer.
const GLOW = '.poster, .top10 a, .cont, .season, .sched-row, .info-box, .settings-group, .spotlight';
let glowTarget = null, glowX = 0, glowY = 0, glowQueued = false;
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  glowTarget = e.target.closest?.(GLOW);
  if (!glowTarget || glowQueued) return;
  glowX = e.clientX; glowY = e.clientY; glowQueued = true;
  requestAnimationFrame(() => {
    glowQueued = false;
    if (!glowTarget) return;
    const r = glowTarget.getBoundingClientRect();
    glowTarget.style.setProperty('--mx', `${glowX - r.left}px`);
    glowTarget.style.setProperty('--my', `${glowY - r.top}px`);
  });
}, { passive: true });

// ---------- "/" focuses search ----------
addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const input = document.querySelector('#nav-search input');
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.select();
});

// ---------- mobile menu ----------
const menuBtn = document.getElementById('menu-btn');
const links = document.getElementById('nav-links');
if (menuBtn && links) {
  const sync = () => menuBtn.setAttribute('aria-expanded', String(links.classList.contains('open')));
  new MutationObserver(sync).observe(links, { attributes: true, attributeFilter: ['class'] });
  addEventListener('animee:navigate', () => links.classList.remove('open'));
}

// ---------- idle whisper ----------
// After a minute without input the page dims and asks "still there? ^^." Any movement wakes it.
// Never on the watch page (people sit still while watching), never blocks input.
const whisper = document.getElementById('whisper');
const IDLE_MS = (Number(new URLSearchParams(location.search).get('idle')) || 60) * 1000;
let idleTimer = 0;
function arm() {
  clearTimeout(idleTimer);
  whisper?.classList.remove('on');
  idleTimer = setTimeout(() => {
    if (document.visibilityState !== 'visible' || location.pathname.startsWith('/watch')) return arm();
    if (document.fullscreenElement) return arm();
    whisper?.classList.add('on');
  }, IDLE_MS);
}
for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  addEventListener(type, arm, { passive: true });
}
arm();

export const motionOk = () => !reduceMotion.matches;
