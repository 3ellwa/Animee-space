// Runs in each page of our sites (top frame only), isolated from the page's own scripts.
//  - Every 5 s: reads <script id="now-playing"> (public/js/nowplaying.js) for Discord.
//  - Clicks on links to other websites open in your normal browser instead of the app.

const { ipcRenderer } = require('electron');

let last = '';
function report() {
  const text = document.getElementById('now-playing')?.textContent || '';
  if (text === last) return;
  last = text;
  // Nothing playing: still say which site you're browsing.
  let data = { site: document.documentElement.dataset.site || 'animee' };
  try { if (text) data = JSON.parse(text); } catch { /* keep "browsing" */ }
  ipcRenderer.send('now-playing', data);
}
setInterval(report, 5000);
window.addEventListener('DOMContentLoaded', () => {
  // The sites hide "Get the app" when they're already in it (.in-app in style.css).
  document.documentElement.classList.add('in-app');
  setTimeout(report, 1500);
});
// Also when the page changes without reloading (the sites are single-page apps).
window.addEventListener('popstate', () => setTimeout(report, 1500));

function isOurs(url) {
  try {
    const u = new URL(url, location.href);
    return u.hostname === 'animee.space' || u.hostname.endsWith('.animee.space') || /(^|\.)localhost$/.test(u.hostname);
  } catch { return false; }
}
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0) return;
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a) return;
  const href = a.href;
  if (!/^https?:/i.test(href)) return;
  if (isOurs(href) && a.target !== '_blank') return; // the page handles its own links
  e.preventDefault();
  ipcRenderer.send('open-external', href);
}, true);
