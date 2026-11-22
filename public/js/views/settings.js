// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, IS_MANGEE, SIBLING } from '../site.js';
import { app, card, esc, loader, readFile, section, takeInstallPrompt } from '../app.js';
import { addHub } from './hub.js';

// ---------- settings ----------
export const ANILIST_IMPORT_LIMIT = 4000;
export function viewSettings(alive) {
  document.title = `Settings · ${BRAND.title}`;
  const s = store.getSettings();
  const user = store.currentUser();
  const radio = (name, value, label, current) => `<label class="chip check"><input type="radio" name="${name}" value="${value}"${current === value ? ' checked' : ''}> ${label}</label>`;
  const toggle = (name, label, on) => `<label class="setting-toggle"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
  app.innerHTML = `<h2 class="hub-sub">settings</h2>
    <p class="card-meta">Saved in this browser.${user ? ` Signed in as <b>${esc(user.name)}</b>: your list and playback choices also sync to your account.` : ' <a href="/account" style="color:var(--accent)">Sign in</a> to sync your list across devices.'}</p>
    <form id="settings" class="settings">
      <section class="settings-group"><h2>Display</h2>
        <div class="setting anime-only"><span>Anime names in</span><div class="chips">${radio('titles', 'english', 'English', s.titles)}${radio('titles', 'japanese', 'Japanese', s.titles)}</div></div>
      </section>
      <section class="settings-group"><h2>Home page</h2>
        ${toggle('showContinue', 'Show Continue watching on the home page', s.showContinue)}
        ${toggle('hideStarted', 'Hide shows I already started from the home rows and picks', s.hideStarted)}
      </section>
      <section class="settings-group" id="hide-genres"><h2>Hide genres</h2>
        <p class="card-meta">Shows in these genres stay out of the home rows, picks and browsing. Searching by name still finds them.</p>
        <div class="chips" id="hide-genre-chips">${loader()}</div>
      </section>
      ${IS_MANGEE ? `<section class="settings-group"><h2>Reading</h2>
        <div class="setting"><span>Chapters in</span><div class="chips">${radio('mangaLang', 'en', 'English', s.mangaLang || 'en')}${radio('mangaLang', 'ar', 'العربية Arabic', s.mangaLang)}${radio('mangaLang', 'ar,en', 'Both', s.mangaLang)}</div></div>
        <div class="setting"><span>Reader</span><div class="chips">${radio('readerMode', 'scroll', 'Scroll down', s.readerMode || 'scroll')}${radio('readerMode', 'pages', 'One page at a time', s.readerMode)}</div></div>
        ${toggle('mangaFull', 'Full-quality images (bigger; data saver is the default)', s.mangaQuality === 'data')}
        <p class="card-meta">Fewer series have Arabic chapters on MangaDex. "Both" shows the Arabic version of a chapter when there is one, English otherwise.</p>
      </section>` : ''}
      <section class="settings-group video-only"><h2>Player</h2>
        <div class="setting anime-only"><span>Audio I prefer</span><div class="chips">${radio('category', 'sub', 'Sub', s.category)}${radio('category', 'dub', 'Dub', s.category)}</div></div>
        ${toggle('autoplay', 'Play the next episode automatically', s.autoplay)}
        ${toggle('skipFiller', 'Skip filler and recap episodes when playing the next one', !!s.skipFiller)}
        <span class="anime-only">${toggle('autoskip', 'Skip intros and outros automatically (on the 3ellwa server)', !!s.autoskip)}</span>
        ${toggle('wide', 'Use the wide player', !!s.wide)}
      </section>
      <section class="settings-group" id="alerts"><h2>Notifications</h2>
        <div class="setting anime-only"><span>Episode alerts for</span><div class="chips">${radio('alertsFor', 'both', 'Sub and dub', s.alertsFor || 'both')}${radio('alertsFor', 'sub', 'Sub only', s.alertsFor)}${radio('alertsFor', 'dub', 'Dub only', s.alertsFor)}</div></div>
        <div class="setting"><span>Pop-ups</span><div class="chips">${radio('alertsWhen', 'now', 'Each new episode', s.alertsWhen || 'now')}${radio('alertsWhen', 'weekly', 'Weekly summary (Sundays)', s.alertsWhen)}</div></div>
        <p class="card-meta">New episodes of shows you follow with 🔔 (and of airing shows on your Watching list) show up in <a href="/new">Notifications</a>.</p>
      </section>
    </form>

    <section class="settings-group" id="push-group"><h2>Pop-ups on this device</h2>
      <p class="card-meta">Get a pop-up when a show you follow gets a new episode, even when ${BRAND.name} is closed.</p>
      <p class="card-meta" id="push-status" role="status">Checking…</p>
      <div class="actions"><button class="btn" id="push-toggle" type="button" hidden></button>
        <button class="btn" id="push-test" type="button" hidden>Send a test pop-up</button></div>
    </section>

    <section class="settings-group" id="install-group"><h2>Install the app</h2>
      <p class="card-meta">Add ${BRAND.title} to your phone or computer and open it like an app, full screen and one tap away. No app store needed.</p>
      <button class="btn" id="install" type="button">Install the app</button>
      <p class="card-meta" id="install-note"></p>
    </section>

    <section class="settings-group anime-only" id="import"><h2>Bring your list</h2>
      <p class="card-meta">Shows that aren't in the catalogue, or are adult-rated, are skipped. Your choice of “add” or “replace” only changes list statuses; watch progress is kept.</p>
      <form id="import-anilist" class="filter-row import-row">
        <input class="input" name="user" placeholder="AniList username" aria-label="AniList username" required pattern="[A-Za-z0-9_]{2,20}">
        <select name="mode" aria-label="Import mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Import from AniList</button>
      </form>
      <p class="card-meta">The AniList list must be public.</p>
      <form id="import-mal" class="filter-row import-row">
        <input class="input" type="file" name="file" accept=".xml,.gz,application/xml,text/xml,application/gzip" aria-label="MyAnimeList export file" required>
        <select name="mode" aria-label="Import mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Import MyAnimeList file</button>
      </form>
      <p class="card-meta">On MyAnimeList, open <i>Export</i> from your list settings, choose Anime, and upload the .xml or .xml.gz file here.</p>
      <p class="import-result" id="import-result" role="status"></p>
    </section>

    <section class="settings-group"><h2>Backup</h2>
      <p class="card-meta">Download your list, progress and history as a file, or restore one.</p>
      <div class="filter-row import-row">
        <button class="btn" id="backup-download" type="button">Download my list</button>
      </div>
      <form id="backup-restore" class="filter-row import-row">
        <input class="input" type="file" name="file" accept=".json,application/json" aria-label="Backup file" required>
        <select name="mode" aria-label="Restore mode"><option value="add">Add to my list</option><option value="replace">Replace my list</option></select>
        <button class="btn" type="submit">Restore</button>
      </form>
      <p class="import-result" id="backup-result" role="status"></p>
    </section>

    <section class="settings-group"><h2>Privacy</h2>
      <p class="card-meta">Your list, history and settings are kept in this browser. With an account, your list, progress and playback choices are also stored on our server so they sync. Watch history never leaves this browser. Clearing site data removes everything here.</p>
      <div class="actions"><button class="btn sm" id="clear-history" type="button">Clear watch history</button>
        <button class="btn sm" id="clear-progress" type="button">Clear history and every watched tick</button></div>
    </section>`;

  // Hide genres: chips filled from the catalogue's genre list.
  api('/genres').then(({ genres }) => {
    const box = document.getElementById('hide-genre-chips');
    if (!box) return;
    const hidden = new Set(store.getSettings().hiddenGenres || []);
    box.innerHTML = genres.map((g) => `<label class="chip check"><input type="checkbox" data-hide-genre value="${esc(g)}"${hidden.has(g) ? ' checked' : ''}> ${esc(g)}</label>`).join('');
  }).catch(() => {});
  document.getElementById('hide-genres').addEventListener('change', (e) => {
    if (!e.target.matches('[data-hide-genre]')) return;
    e.stopPropagation();
    const set = new Set(store.getSettings().hiddenGenres || []);
    if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
    store.setSetting('hiddenGenres', [...set]);
  });

  // Settings apply as soon as they change.
  const form = document.getElementById('settings');
  form.onchange = (e) => {
    const el = e.target;
    if (el.matches('[data-hide-genre]')) return; // handled above
    if (el.name === 'mangaFull') { store.setSetting('mangaQuality', el.checked ? 'data' : 'data-saver'); return; }
    store.setSetting(el.name, el.type === 'checkbox' ? el.checked : el.value);
    if (el.name === 'alertsWhen') push.syncFollows();
    if (el.name === 'alertsFor') { push.syncFollows(); inbox.refreshInbox({ force: true }).catch(() => {}); }
  };

  // Pop-ups on this device.
  const pushStatus = document.getElementById('push-status');
  const pushToggle = document.getElementById('push-toggle');
  const pushTest = document.getElementById('push-test');
  const drawPush = async () => {
    if (!push.supported()) { pushStatus.textContent = 'This browser can\'t show pop-ups.'; return; }
    if (!(await push.serverKey())) { pushStatus.textContent = `Pop-ups aren't switched on for ${BRAND.name} yet.`; return; }
    const on = await push.isOn();
    const perm = push.permission();
    const following = store.followedIds().length;
    pushStatus.textContent = on
      ? `On. You follow ${following} show${following === 1 ? '' : 's'}; each new episode pops up here.`
      : perm === 'denied'
        ? `Your browser is blocking notifications for ${BRAND.name}. Click the icon left of the address, set Notifications to Allow, then press Turn on.`
        : push.needsInstall() ? `On iPhone and iPad, add ${BRAND.name} to your Home Screen first (Share → Add to Home Screen), then turn pop-ups on from there.`
          : 'Off on this device.';
    pushToggle.hidden = false;
    pushToggle.textContent = on ? 'Turn off' : 'Turn on pop-ups';
    pushTest.hidden = !on;
  };
  pushToggle.onclick = async () => {
    pushToggle.disabled = true;
    try {
      if (await push.isOn()) await push.disable(); else await push.enable();
      await drawPush();
    } catch (err) { pushStatus.textContent = err.message; } finally { pushToggle.disabled = false; }
  };
  pushTest.onclick = async () => {
    pushTest.disabled = true;
    try {
      const r = await push.test();
      pushStatus.textContent = r.ok ? 'Test sent. It should pop up in a few seconds.' : 'The push service didn\'t accept it. Try turning pop-ups off and on.';
    } catch (err) { pushStatus.textContent = err.message; } finally { pushTest.disabled = false; }
  };
  drawPush();

  // Install: browsers that support it fire beforeinstallprompt; iPhone and iPad need the Share menu.
  const installBtn = document.getElementById('install');
  const installNote = document.getElementById('install-note');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) { installBtn.hidden = true; installNote.textContent = 'You are already using the installed app.'; }
  else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { installBtn.hidden = true; installNote.textContent = 'On iPhone or iPad: tap Share in Safari, then Add to Home Screen.'; }
  installBtn.onclick = async () => {
    const promptEvent = takeInstallPrompt();
    if (!promptEvent) { installNote.textContent = `Your browser doesn't offer installing right now. In Chrome or Edge, use the install icon in the address bar, or the menu, then Install ${BRAND.title}.`; return; }
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
    installNote.textContent = outcome === 'accepted' ? `Installed. You can open ${BRAND.title} from your home screen or apps.` : '';
  };

  const importResult = document.getElementById('import-result');
  const finishImport = (added, skipped, source) => {
    importResult.textContent = `${added.toLocaleString()} show${added === 1 ? '' : 's'} added from ${source}${skipped ? `, ${skipped.toLocaleString()} skipped` : ''}.`;
    store.ensureMeta(store.libraryIds()).catch(() => {});
  };

  document.getElementById('import-anilist').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    importResult.textContent = 'Reading your AniList list…';
    try {
      // Asked from the browser: AniList refuses requests from Cloudflare's servers.
      const d = await aniList.importAniListUser(f.get('user'));
      const items = d.items.slice(0, ANILIST_IMPORT_LIMIT);
      finishImport(store.importEntries(items, f.get('mode')), d.skipped + (d.items.length - items.length), 'AniList');
    } catch (err) {
      importResult.textContent = err.message;
    } finally { btn.disabled = false; }
  };

  document.getElementById('import-mal').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const file = f.get('file');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    importResult.textContent = 'Reading your MyAnimeList file…';
    try {
      const text = /\.gz$/i.test(file.name)
        ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await readFile(file);
      const { items, skipped } = parseMalExport(text);
      finishImport(store.importEntries(items, f.get('mode')), skipped, 'MyAnimeList');
    } catch (err) {
      importResult.textContent = err.message;
    } finally { btn.disabled = false; }
  };

  document.getElementById('backup-download').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportBackup(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${BRAND.backup}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('backup-restore').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const out = document.getElementById('backup-result');
    if (f.get('mode') === 'replace' && !confirm('Replace your whole list with this backup?')) return;
    try {
      const restored = store.restoreBackup(JSON.parse(await readFile(f.get('file'))), f.get('mode'));
      out.textContent = restored ? `${restored.toLocaleString()} show${restored === 1 ? '' : 's'} restored.` : 'Nothing new to restore: everything in that file is already on your list.';
    } catch (err) {
      out.textContent = err instanceof SyntaxError ? 'That file isn\'t a valid backup.' : err.message;
    }
  };
  document.getElementById('clear-history').onclick = (e) => {
    if (!confirm('Clear your watch history in this browser?')) return;
    store.clearHistory();
    e.target.textContent = 'History cleared';
  };
  document.getElementById('clear-progress').onclick = (e) => {
    if (!confirm('Clear your watch history, Continue watching and every watched tick? Your list and favourites stay.')) return;
    store.clearHistory();
    store.clearProgress();
    e.target.textContent = 'Cleared';
  };
  addHub('settings');
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// MyAnimeList's export: <anime><series_animedb_id/><series_title/><series_type/><series_episodes/><my_watched_episodes/><my_status/></anime>
export const MAL_STATUS = { watching: 'watching', 'plan to watch': 'planning', completed: 'completed', 'on-hold': 'paused', dropped: 'dropped' };
export function parseMalExport(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('myanimelist')) throw new Error('That file isn\'t a MyAnimeList anime export.');
  const field = (node, name) => node.querySelector(name)?.textContent.trim() || '';
  let skipped = 0;
  const items = [];
  for (const node of doc.querySelectorAll('anime')) {
    const id = field(node, 'series_animedb_id');
    const status = MAL_STATUS[field(node, 'my_status').toLowerCase()] || MAL_STATUS[{ 1: 'watching', 2: 'completed', 3: 'on-hold', 4: 'dropped', 6: 'plan to watch' }[field(node, 'my_status')]];
    if (!/^\d+$/.test(id) || !status) { skipped++; continue; }
    const episodes = Number(field(node, 'series_episodes')) || null;
    items.push({
      id, status,
      title: field(node, 'series_title') || null,
      format: field(node, 'series_type').toUpperCase() || null,
      episodes,
      watchedUpTo: status === 'completed' ? episodes || Number(field(node, 'my_watched_episodes')) || 0 : Number(field(node, 'my_watched_episodes')) || 0,
    });
  }
  if (!items.length && !skipped) throw new Error('No anime found in that file.');
  return { items, skipped };
}
