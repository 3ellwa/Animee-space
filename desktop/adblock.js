// Ad and tracker blocking with Ghostery's engine: the same kind of filter lists Brave uses
// (EasyList, EasyPrivacy, uBlock Origin's), applied to every request, inside video players
// too, plus hiding the empty boxes ads leave behind. The lists are kept on disk and
// refreshed from Ghostery's CDN at most once a day.
//
// Our own sites and the catalogues/images they need are never blocked.

const fs = require('node:fs');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

const ALWAYS_ALLOW = [
  '@@||animee.space^',
  '@@||mangadex.org^',
  '@@||mangadex.network^',
  '@@||image.tmdb.org^',
];
const DAY = 24 * 60 * 60 * 1000;
let blocker = null;

async function start(session, cachePath, enabled) {
  const fresh = (() => { try { return Date.now() - fs.statSync(cachePath).mtimeMs < DAY; } catch { return false; } })();
  if (!fresh) { try { fs.unlinkSync(cachePath); } catch { /* none yet */ } }
  blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: cachePath,
    read: fs.promises.readFile,
    write: fs.promises.writeFile,
  });
  blocker.updateFromDiff({ added: ALWAYS_ALLOW });
  if (enabled) blocker.enableBlockingInSession(session);
  return blocker;
}

function setEnabled(session, on) {
  if (!blocker) return;
  if (on && !blocker.isBlockingEnabled(session)) blocker.enableBlockingInSession(session);
  if (!on && blocker.isBlockingEnabled(session)) blocker.disableBlockingInSession(session);
}

module.exports = { start, setEnabled };
