// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from '../site.js';
import { setNowPlaying, clearNowPlaying } from '../nowplaying.js';
import { isTv, setMedia } from '../tv.js';
import { FORMAT, STATUS, T, animeHref, app, bindFollow, bindListSelect, card, clock, countPlay, epName, esc, followButton, go, grid, isMovie, listSelect, loadExtras, loadSeasons, mediaPrefsFor, onCleanup, plural, saveMediaPrefs, score, section, toastNote, viewNotFound } from '../app.js';

// ---------- watch ----------
export async function viewWatch(id, query, alive) {
  if (!id) return viewNotFound();
  // html.watching: TV mode drops its page zoom here (style.css, "TV video safety").
  document.documentElement.classList.add('watching');
  onCleanup(() => document.documentElement.classList.remove('watching'));
  // Show the page's shape straight away (player, episode panel) with what is being loaded,
  // using the poster this browser already knows, instead of a bare spinner.
  const known = store.getList()[id] || store.getProgress(id) || {};
  app.innerHTML = `
    <div class="watch-skel" aria-busy="true">
      <div class="crumbs card-meta">${known.title ? esc(known.title) : 'Loading…'}</div>
      <div class="watch-grid"><div>
        <div class="player skel-player"${known.cover ? ` style="--poster:url('${esc(known.cover)}')"` : ''}>
          <div class="pl-msg busy"><span class="pl-spin" aria-hidden="true"></span><span id="skel-step" role="status">Getting the show…</span></div>
        </div>
        <div class="skel-bar"></div>
      </div>
      <aside><div class="ep-box skel-eps">${'<i></i>'.repeat(24)}</div></aside></div>
    </div>`;
  const step = (text) => { const el = document.getElementById('skel-step'); if (el && alive()) el.textContent = text; };
  // The server list for the likely episode is fetched in parallel, so it's cached by the time it's needed.
  const guessEp = Number(query.get('ep')) || store.getProgress(id)?.ep || 1;
  // VidNest and TryEmbed need the show's AniList ID, which only the browser can look up
  // (AniList refuses Cloudflare's servers). Start now; it's remembered for 30 days.
  const aniListIdP = aniList.aniListIdFor(id);
  api(`/episode/${encodeURIComponent(`${id}:${guessEp}`)}/servers`).catch(() => {});

  // Fetch the latest progress from the account alongside the show, so another device's
  // episode and position are used (never waits more than a couple of seconds).
  const showP = api(`/anime/${id}`);
  const epsP = api(`/anime/${id}/episodes`);
  showP.then(() => step('Loading the episode list…'), () => {});
  epsP.then((d) => step(`Found ${plural(d.episodes?.length || 0, 'episode')}. Syncing your progress…`), () => {});
  const [a, epData] = await Promise.all([showP, epsP, store.sync.freshen()]);
  if (!alive()) return;
  document.title = `Watch ${a.title} · ${BRAND.title}`;
  store.rememberMeta(a);
  const episodes = epData.episodes;

  if (!episodes.length) {
    app.innerHTML = `<div class="empty"><h2>No episodes yet</h2><p>${esc(T(a))} ${IS_CINEMEE ? "isn't out yet" : "hasn't released any episodes"}.</p>
      <a class="btn" href="${animeHref(a)}">Back to details</a></div>`;
    return;
  }

  const settings = store.getSettings();
  const prog = store.getProgress(a.id);
  // ?season=2 (from a TV page's season card): that season's first episode in this list.
  const seasonStart = Number(query.get('season')) ? episodes.find((e) => e.season === Number(query.get('season')))?.number : null;
  const wantEp = Number(query.get('ep')) || seasonStart || prog?.ep || 1;
  let current = episodes.find((e) => e.number === wantEp) || episodes[0];
  const missingEp = query.get('ep') && current.number !== wantEp ? wantEp : null;
  // ?t=754 from a "Share moment" link: start there (once).
  let sharedAt = /^\d{1,5}$/.test(query.get('t') || '') ? Number(query.get('t')) : null;
  // Watch party (see the party section below). partyAt: where a guest should start the next load.
  let party = null;
  let partyAt = null;
  let servers = [];
  let server = null; // { id, category }
  const watched = store.watchedSet(a.id);
  const CHUNK = 100;
  // The episode picker: cinemee TV shows with several seasons go season by season; long lists
  // otherwise go 100 at a time. Each group is a slice [from, to) of `episodes`.
  const bySeason = episodes.some((e) => e.season) && new Set(episodes.map((e) => e.season)).size > 1;
  const groups = [];
  if (bySeason) {
    episodes.forEach((e, i) => {
      const last = groups[groups.length - 1];
      if (last && last.season === e.season) last.to = i + 1;
      else groups.push({ season: e.season, from: i, to: i + 1 });
    });
    groups.forEach((g) => { g.label = `Season ${g.season} (${g.to - g.from})`; });
  } else if (episodes.length > CHUNK) {
    for (let from = 0; from < episodes.length; from += CHUNK) {
      const to = Math.min(from + CHUNK, episodes.length);
      groups.push({ from, to, label: `${from + 1}-${to}` });
    }
  }
  // Titles next to the numbers when the list (or each season) is short enough.
  const wide = (bySeason ? Math.max(...groups.map((g) => g.to - g.from)) <= 40 : episodes.length <= 30) && episodes.some((e) => e.title && !/^Episode \d+$/.test(e.title));
  const groupOf = (i) => Math.max(0, groups.findIndex((g) => i >= g.from && i < g.to));
  // Availability is determined by the configured providers for each episode.
  // Do not disable an episode based on MegaPlay-only availability when other servers exist.
  const playable = () => true;
  const fillerCount = episodes.filter((e) => e.isFiller).length;
  const recapCount = episodes.filter((e) => e.isRecap).length;

  app.innerHTML = `
    <div class="crumbs"><a href="/">Home</a> › <a href="${animeHref(a)}">${esc(T(a))}</a> › <span id="crumb-ep"></span></div>
    <div class="watch-grid${isMovie(a) ? ' is-movie' : ''}">
      <div>
        <div class="player-wrap">
          <div id="player"></div>
          <div class="pl-bar">
            <label><input type="checkbox" id="opt-autoplay" ${settings.autoplay ? 'checked' : ''}> Auto next</label>
            ${fillerCount || recapCount ? `<label title="Auto next skips filler and recap episodes"><input type="checkbox" id="opt-skipfiller" ${settings.skipFiller ? 'checked' : ''}> Skip filler</label>` : ''}
            <label class="anime-only" title="Skips intros and outros where the player knows them (Kaze server)"><input type="checkbox" id="opt-autoskip" ${settings.autoskip ? 'checked' : ''}> Auto skip intro</label>
            <span class="card-meta player-hint keys-hint" tabindex="0" title="Pause, seek and quality are inside the player. Keys: N next, P previous, ← → 10 seconds, W watched, F fullscreen.">⌨ Shortcuts</span>
            <span class="spacer"></span>
            <button class="btn sm wide-btn" id="wide-toggle" type="button" aria-pressed="false">⤢ Wide player</button>
            <button class="btn sm" id="mark-seen" type="button">✓ Mark watched</button>
            ${IS_CINEMEE ? '<button class="btn sm" id="subs-btn" type="button" title="Use your own .srt or .vtt subtitle file (plays on the Atlas server)">CC Your subtitles</button><input type="file" id="subs-file" accept=".srt,.vtt,text/vtt,application/x-subrip" hidden>' : ''}
            <button class="btn sm" id="speed-btn" type="button" hidden title="Playback speed (remembered for this show)">1×</button>
            <button class="btn sm" id="party-btn" type="button" title="Watch together: friends with the link follow your episode and position">👥 Watch party</button>
            <button class="btn sm" id="share-moment" type="button" title="Copy a link that opens this episode at this moment">↗ Share moment</button>
            <details class="report-menu" id="report-menu">
              <summary class="btn sm">⚑ Report</summary>
              <div class="report-pop" role="group" aria-label="What's wrong with this episode?">
                <span class="card-meta">What's wrong?</span>
                <button class="btn sm" type="button" data-r="video">Video won't play</button>
                <button class="btn sm" type="button" data-r="wrong">Wrong episode</button>
                <button class="btn sm" type="button" data-r="subs">Subtitles missing or wrong</button>
                <button class="btn sm" type="button" data-r="audio">Audio problem</button>
                <button class="btn sm" type="button" data-r="other">Something else</button>
              </div>
            </details>
            <button class="btn sm" id="prev-ep">‹ Prev</button>
            <button class="btn sm next-glow" id="next-ep">Next ›</button>
          </div>
        </div>
        <div class="servers">
          <div class="now">You are watching<b id="now-ep"></b><span id="server-hint">If one server doesn't work, try another.</span></div>
          <div class="resume-note" id="resume-note" hidden></div>
          <div id="server-list"></div>
          <div class="not-working"><button class="btn sm" id="not-working" type="button">⚠ Not working? Try another server</button></div>
        </div>
        <section class="section">
          <div style="display:flex;gap:18px;align-items:flex-start">
            <img src="${esc(a.cover)}" alt="" style="width:110px;border-radius:10px">
            <div>
              <h2 style="margin:0 0 6px"><a href="${animeHref(a)}">${esc(T(a))}</a></h2>
              <div class="chips" style="margin:6px 0 10px">
                ${a.score ? `<span class="chip">★ ${score(a.score)}</span>` : ''}
                ${a.format ? `<span class="chip">${FORMAT[a.format]}</span>` : ''}
                <span class="chip">${STATUS[a.status] || ''}</span>
              </div>
              <div class="desc clamp">${esc(a.description || '')}</div>
              <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${listSelect(a)}${followButton(a, true)}</div>
            </div>
          </div>
        </section>
        <div id="watch-seasons"></div>
        <div id="watch-recs"></div>
      </div>
      <aside>
        <div class="ep-box">
          <div class="ep-head">
            <h3>Episodes <small class="card-meta">(${episodes.length})</small></h3>
            ${groups.length > 1 ? `<select id="ep-range" aria-label="${bySeason ? 'Season' : 'Episodes'}">${groups.map((g, i) => `<option value="${i}">${esc(g.label)}</option>`).join('')}</select>` : ''}
            <input class="input" id="ep-find" type="number" min="1" max="${episodes.length}" placeholder="EP #">
          </div>
          <div class="ep-list${wide ? ' wide' : ''}" id="ep-list"></div>
          ${fillerCount || recapCount ? `<div class="ep-legend">Filler guide: <span class="lg filler">${fillerCount} filler</span>${recapCount ? ` · <span class="lg recap">${recapCount} recap</span>` : ''} · <span class="lg canon">${episodes.length - fillerCount - recapCount} story</span></div>` : ''}
        </div>
      </aside>
    </div>`;

  bindListSelect(a);
  bindFollow(a, true);
  const $ = (sel) => document.getElementById(sel);
  const idx = () => episodes.indexOf(current);
  // Next episode for auto next: playable, and not filler or recap when "Skip filler" is on.
  const nextAuto = () => {
    const skip = store.getSettings().skipFiller;
    return episodes.slice(idx() + 1).find((e) => playable(e) && !(skip && (e.isFiller || e.isRecap))) || null;
  };

  // Keep the list status in step with what you actually watch:
  //  - playing a show that's on "Plan to watch" or "On hold" moves it to Watching;
  //  - finishing the last episode of a finished show marks it Completed.
  // Each change shows a note with Undo. Dropped / Not interested / Completed are never touched
  // by starting to watch, so rewatching a completed show leaves it alone.
  function autoStatus(why) {
    const status = store.getEntry(a.id)?.status || null;
    const last = episodes[episodes.length - 1];
    let next = null;
    if (why === 'ended' && a.status === 'FINISHED' && current === last && status !== 'completed') next = 'completed';
    else if (why === 'started' && (status === 'planning' || status === 'paused')) next = 'watching';
    if (!next) return;
    store.setEntry(a, next);
    const redraw = () => {
      const sel = document.getElementById('list-status');
      if (sel) { sel.outerHTML = listSelect(a); bindListSelect(a); }
    };
    redraw();
    const label = next === 'completed' ? 'Completed' : 'Watching';
    showNote(`Moved to <b>${label}</b> on your list. <button class="btn sm" type="button">Undo</button>`, () => {
      store.setEntry(a, status);
      redraw();
    });
  }

  const player = new Player($('player'), {
    autoskip: () => store.getSettings().autoskip,
    hasNext: () => !!nextAuto(),
    onNext: () => goTo(nextAuto()),
    onPause: () => store.sync.flush(),
    onAutoSkipPaused: () => showNote('Auto skip is paused for this episode because you went back. It turns on again for the next one.'),
    // MegaPlay resumed at the saved time: say so, with a way back to the beginning.
    onResumed: (at) => showNote(`Picked up where you stopped, at <b>${clock(at)}</b>. <button class="btn sm" type="button">Start over</button>`, () => player.seekTo(0)),
    onFail: (message) => tryNextServer(message),
    serverCount: () => new Set(servers.map((s) => s.id)).size,
    // Per show: speed and volume on our own player (Kaze), remembered in this browser.
    mediaPrefs: () => mediaPrefsFor(a.id),
    onReady: () => updateSpeedBtn(),
    onMediaPrefs: (p) => { saveMediaPrefs(a.id, p); updateSpeedBtn(); },
    onStarted: () => {
      countPlay(a.id);
      updateSpeedBtn();
      if (server) store.setGoodServer(a.id, server.category, server.id);
      // An episode counts as watched as soon as it starts playing (it gets its tick in the list,
      // Continue watching and New episodes move on), like tapping "Mark watched".
      if (!watched.has(current.number)) {
        store.markWatched(a.id, current.number);
        watched.add(current.number);
        showSeen();
        renderEpisodes();
      }
    },
    onEnded: () => {
      store.markWatched(a.id, current.number);
      watched.add(current.number);
      autoStatus('ended');
      store.sync.flush();
      const next = nextAuto();
      renderEpisodes();
      if (store.getSettings().autoplay && next) {
        const skipped = next.number - current.number - 1;
        player.upNext({
          title: `${epName(next)}${next.title && !/^Episode \d+$/.test(next.title) ? ` · ${next.title}` : ''}`,
          label: skipped > 0 ? `Skipping ${skipped} filler/recap episode${skipped > 1 ? 's' : ''}` : '',
          onGo: () => goTo(next),
        });
      }
    },
    onProgress: ({ time, duration, ep }) => {
      if (duration) lastDuration = duration;
      store.saveProgress({ animeId: a.id, ep, time, duration, title: a.title, cover: a.cover });
      if (time > 120) autoStatus('started');
      if (duration && time / duration > 0.85 && !watched.has(ep)) {
        store.markWatched(a.id, ep);
        watched.add(ep);
        showSeen();
      }
    },
  });
  onCleanup(() => { player.destroy(); store.sync.flush(); });

  // "Now playing" for Discord presence (see nowplaying.js), refreshed every few seconds.
  let lastDuration = 0;
  function publishNow() {
    setNowPlaying({
      kind: 'watching',
      title: T(a),
      episode: isMovie(a) ? '' : epName(current),
      episodeTitle: current.title && !/^Episode \d+$/.test(current.title) ? current.title : '',
      season: current.season ?? null,
      // Within its season on cinemee TV (S2 · E1 is number 11 in the full list).
      number: current.season && current.episode ? current.episode : current.number,
      time: player.hasTime() ? player.getCurrentTime() : null,
      duration: lastDuration || null,
      paused: player.isPausedHere(),
      cover: a.cover,
      url: animeHref(a),
    });
  }
  publishNow();
  const nowTimer = setInterval(publishNow, 5000);
  onCleanup(() => { clearInterval(nowTimer); clearNowPlaying(); });

  // Picked up a newer position from another device while this page was open (e.g. the phone
  // was left on this page): offer to jump there rather than yanking the video around.
  const note = $('resume-note');
  const showNote = (html, onClick) => {
    note.innerHTML = html;
    note.hidden = !html;
    const b = note.querySelector('button');
    if (b) b.onclick = () => { note.hidden = true; onClick(); };
  };
  onCleanup(store.onSyncChange(({ pulled, changed }) => {
    if (!pulled || !changed?.has(String(a.id)) || !alive()) return;
    const p = store.getProgress(a.id);
    if (!p) return;
    const sameEp = p.ep === current.number;
    if (sameEp && Math.abs(p.time - player.getCurrentTime()) < 30) return;
    const target = episodes.find((e) => e.number === p.ep);
    if (!target) return;
    if (party) return; // in a watch party the host decides
    const where = `${isMovie(a) ? '' : `${esc(epName(target))} · `}${clock(p.time)}`;
    note.innerHTML = `📱 You're at <b>${where}</b> on another device. <button class="btn sm primary" type="button" data-go>Switch to it</button> <button class="btn sm" type="button" data-stay>Stay here</button>`;
    note.hidden = false;
    note.querySelector('[data-go]').onclick = () => { note.hidden = true; if (sameEp) playSource(p.time); else goTo(target); };
    note.querySelector('[data-stay]').onclick = () => { note.hidden = true; };
  }));
  // Both devices open at once: while this player sits idle (paused or not started), look for
  // progress from the other device every 45 seconds.
  let idleSince = player.getCurrentTime();
  const devicePoll = setInterval(() => {
    const t = player.getCurrentTime();
    const idle = Math.abs(t - idleSince) < 5;
    idleSince = t;
    // Only players that report their time (t > 0): one that never does (Nova) would look idle
    // forever and pull the whole library every 45 seconds.
    if (idle && t > 0 && document.visibilityState === 'visible' && store.currentUser()) store.sync.freshen({ maxAge: 30000 });
  }, 45000);
  onCleanup(() => clearInterval(devicePoll));

  $('opt-autoplay').onchange = (e) => store.setSetting('autoplay', e.target.checked);
  $('opt-autoskip').onchange = (e) => { store.setSetting('autoskip', e.target.checked); player.setAutoSkip(e.target.checked); };
  // "Not working": note it for us, then move to the next server (or the other language).
  $('not-working').onclick = () => {
    report('video');
    if (!tryNextServer("That server didn't work for you.")) player.msg('No other server is left for this episode. Try again later.');
  };
  // Break reminder: after about 2 hours of actual watching (a 30-minute pause starts the count again).
  const BREAK_KEY = 'animee-space:break-off';
  let watchedFor = 0, lastSeen = player.getCurrentTime(), quietFor = 0;
  const breakTimer = setInterval(() => {
    let off = false;
    try { off = localStorage.getItem(BREAK_KEY) === '1'; } catch { /* ignore */ }
    if (off || document.visibilityState !== 'visible') return;
    const now = player.getCurrentTime();
    if (now !== lastSeen) { watchedFor += 30; quietFor = 0; } else if ((quietFor += 30) >= 1800) watchedFor = 0;
    lastSeen = now;
    if (watchedFor >= 7200) {
      watchedFor = 0;
      showNote('You have been watching for about 2 hours. Maybe stretch, drink some water ^^. <button class="btn sm" type="button">Stop these reminders</button>',
        () => { try { localStorage.setItem(BREAK_KEY, '1'); } catch { /* ignore */ } });
    }
  }, 30000);
  onCleanup(() => clearInterval(breakTimer));
  if ($('opt-skipfiller')) $('opt-skipfiller').onchange = (e) => store.setSetting('skipFiller', e.target.checked);
  const applyWide = (on) => {
    app.querySelector('.watch-grid').classList.toggle('wide', on);
    $('wide-toggle').setAttribute('aria-pressed', on);
    $('wide-toggle').textContent = on ? '⤡ Normal player' : '⤢ Wide player';
  };
  applyWide(!!store.getSettings().wide);
  $('wide-toggle').onclick = () => {
    const on = !store.getSettings().wide;
    store.setSetting('wide', on);
    applyWide(on);
  };
  loadExtras(a.id, alive, { recs: 'watch-recs' });
  loadSeasons(a, alive, 'watch-seasons', 'watch');
  const showSeen = () => {
    const seen = watched.has(current.number);
    $('mark-seen').disabled = seen;
    $('mark-seen').textContent = seen ? '✓ Watched' : '✓ Mark watched';
  };
  $('mark-seen').onclick = () => {
    store.markWatched(a.id, current.number);
    watched.add(current.number);
    showSeen();
    renderEpisodes();
  };
  $('prev-ep').onclick = () => idx() > 0 && goTo(episodes[idx() - 1]);
  // Shortcuts work while focus is on the page. Clicking into the embedded player gives it the
  // keyboard, so they pause until you click back outside it.
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    // ← / → jump 10 seconds (they never change the episode: people press → to skip intros).
    // On a TV the arrows move between buttons, so they only skip while the player is selected.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isTv() && !e.target.closest?.('.player')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (player.seekBy(e.key === 'ArrowRight' ? 10 : -10)) e.preventDefault();
      return;
    }
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    const actions = {
      n: () => $('next-ep').click(),
      p: () => $('prev-ep').click(),
      w: () => !$('mark-seen').disabled && $('mark-seen').click(),
      f: () => player.enterFullscreen(),
    };
    if (!actions[key]) return;
    e.preventDefault();
    actions[key]();
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => document.removeEventListener('keydown', onKey));
  // The TV remote's play/pause, fast-forward/rewind and channel up/down (tv.js).
  const NO_REMOTE_PAUSE = `This server can’t be paused from the remote. ${IS_CINEMEE ? '3ellwa can' : '3ellwa, JoJo and Rem can'}.`;
  onCleanup(setMedia({
    playerBox: $('player').querySelector('.player'),
    // On a TV the picture is most reliable full screen (the video gets the TV's video layer to
    // itself), so starting to play from the remote also goes full screen. Back leaves it.
    playPause: () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) player.enterFullscreen({ quiet: true });
      if (!player.togglePlay()) toastNote(NO_REMOTE_PAUSE);
    },
    setPaused: (paused) => {
      if (!paused && !document.fullscreenElement && !document.webkitFullscreenElement) player.enterFullscreen({ quiet: true });
      if (!player.setPaused(paused)) toastNote(NO_REMOTE_PAUSE);
    },
    seekBy: (s) => player.seekBy(s),
    next: () => $('next-ep').click(),
    prev: () => $('prev-ep').click(),
  }));
  $('next-ep').onclick = () => idx() < episodes.length - 1 && goTo(episodes[idx() + 1]);
  // ---------- your own subtitles (cinemee, Atlas) ----------
  const SUBS_KEY = 'animee-space:custom-subs';
  const subsKey = () => `${a.id}:${current.number}`;
  function customSub() {
    try { return JSON.parse(sessionStorage.getItem(SUBS_KEY) || '{}')[subsKey()] || null; } catch { return null; }
  }
  if ($('subs-btn')) {
    $('subs-btn').onclick = () => $('subs-file').click();
    $('subs-file').onchange = async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 500 * 1024) { toastNote('That file is too big (500 KB at most).'); return; }
      try {
        // The server turns .srt into WebVTT (functions/_lib/subs.js).
        const text = await f.text();
        const r = await fetch('/api/subs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        const label = f.name.replace(/\.(srt|vtt)$/i, '').slice(0, 40) || 'My subtitles';
        let all = {};
        try { all = JSON.parse(sessionStorage.getItem(SUBS_KEY) || '{}'); } catch { /* ignore */ }
        all[subsKey()] = { url: d.url, label };
        try { sessionStorage.setItem(SUBS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
        // Atlas is the server that takes subtitle files: switch to it and reload at the same spot.
        const atlas = servers.find((s) => s.id === 'embedmaster');
        if (!atlas) throw new Error('The Atlas server isn\u2019t available for this title.');
        server = { id: atlas.id, category: atlas.category };
        renderServers();
        toastNote(`Subtitles added (“${esc(label)}”). Playing on Atlas; pick them in its CC menu if they don’t show.`);
        playSource(player.getCurrentTime(), { explicit: true });
      } catch (err) { toastNote(esc(err.message)); }
    };
  }

  // Speed button (our own player only): 1× → 1.25× → 1.5× → 1.75× → 2× → 0.75× → 1×.
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  function updateSpeedBtn() {
    const b = $('speed-btn');
    if (!b) return;
    b.hidden = !player.isNative();
    b.textContent = `${player.getRate()}×`;
  }
  $('speed-btn').onclick = () => {
    const now = player.getRate();
    const next = SPEEDS[(SPEEDS.indexOf(now) + 1) % SPEEDS.length] || 1;
    player.setRate(next);
    updateSpeedBtn();
  };
  $('share-moment').onclick = async () => {
    const t = Math.floor(player.getCurrentTime() || 0);
    const url = `${location.origin}/watch/${a.id}?ep=${current.number}${t > 5 ? `&t=${t}` : ''}`;
    const what = `${isMovie(a) ? a.title : `${a.title} · ${epName(current)}`}${t > 5 ? ` at ${clock(t)}` : ''}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ title: what, url }).catch(() => {});
    try {
      await navigator.clipboard.writeText(url);
      toastNote(`Link copied: ${esc(what)}.${t > 5 ? '' : ' (The player hasn’t said where it is, so it opens at the start.)'}`);
    } catch { prompt('Copy this link', url); }
  };

  let range = groupOf(idx());
  function renderEpisodes() {
    const slice = groups.length > 1 ? episodes.slice(groups[range].from, groups[range].to) : episodes;
    $('ep-list').innerHTML = slice.map((e) => `
      <button class="ep${e === current ? ' on' : ''}${watched.has(e.number) ? ' seen' : ''}${e.isFiller ? ' filler' : ''}${e.isRecap ? ' recap' : ''}${playable(e) ? '' : ' na'}"
        data-n="${e.number}" title="${e.label ? `${esc(e.label)}: ` : ''}${esc(e.title)}${e.isFiller ? ' (filler)' : e.isRecap ? ' (recap)' : ''}${playable(e) ? '' : ' (not available yet)'}">${wide ? `${e.label ? esc(e.label) : e.number}. ${esc(e.title)}` : e.label ? `S${e.season}E${e.episode}` : e.number}</button>`).join('');
    if ($('ep-range')) $('ep-range').value = String(range);
    // Scroll only the episode list, never the page, so the player stays in view on phones.
    const list = $('ep-list');
    const on = list.querySelector('.ep.on');
    if (on && list.scrollHeight > list.clientHeight) {
      const offset = on.getBoundingClientRect().top - list.getBoundingClientRect().top;
      list.scrollTop += offset - (list.clientHeight - on.offsetHeight) / 2;
    }
  }
  $('ep-list').onclick = (e) => {
    const b = e.target.closest('.ep');
    if (b) goTo(episodes.find((x) => x.number === Number(b.dataset.n)));
  };
  if ($('ep-range')) $('ep-range').onchange = (e) => { range = Number(e.target.value); renderEpisodes(); };
  $('ep-find').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const target = episodes.find((x) => x.number === Number(e.target.value));
    if (target) goTo(target);
  };

  function renderServers() {
    const groups = ['sub', 'dub'].map((cat) => {
      const list = servers.filter((s) => s.category === cat);
      if (!list.length) return '';
      return `<div class="srv-row"><span class="lab">${IS_CINEMEE ? 'play' : cat}</span><div class="srv-btns">${list.map((s) => `
        <button class="srv${server && server.id === s.id && server.category === cat ? ' on' : ''}" data-id="${esc(s.id)}" data-cat="${cat}"${playable(current, cat) ? (s.struggling ? ' title="Has had trouble with this episode lately"' : '') : ` disabled title="Not out in ${cat} for this episode yet"`}>${esc(s.name)}${s.struggling ? ' <span class="srv-warn" aria-label="has had trouble lately">!</span>' : ''}</button>`).join('')}</div></div>`;
    }).join('');
    $('server-list').innerHTML = groups || '<span class="card-meta">No servers available.</span>';
    // One server (cinemee): nothing to switch to, so no "try another" hint or button.
    const several = new Set(servers.map((s) => s.id)).size > 1;
    $('server-hint').hidden = !several;
    $('not-working').closest('.not-working').hidden = !several;
  }
  $('server-list').onclick = (e) => {
    const b = e.target.closest('.srv');
    if (!b) return;
    server = { id: b.dataset.id, category: b.dataset.cat };
    tried.delete(server.id);
    store.setShowCategory(a.id, server.category);
    store.setSetting('category', server.category);
    // Becomes the default server only once it actually plays (see playSource).
    chosenServer = server.id;
    renderServers();
    playSource(player.getCurrentTime());
  };

  // Servers that already failed for this episode, so an automatic retry never loops.
  let tried = new Set();
  // A server you clicked, until we know whether it played.
  let chosenServer = null;
  // explicit: ask for exactly this server (automatic retries), instead of "this one first".
  async function playSource(startAt, { explicit = false } = {}) {
    const ep = current;
    player.busy(explicit ? `Trying ${serverName(server)}…` : 'Loading episode…');
    try {
      const mode = explicit ? `server=${encodeURIComponent(server.id)}` : `server=auto&preferred=${encodeURIComponent(server.id)}`;
      // Wait briefly for the AniList ID; without it VidNest/TryEmbed are simply skipped by the fallback.
      const al = await Promise.race([aniListIdP, new Promise((r) => setTimeout(() => r(null), 2500))]);
      const src = await api(`/episode/${encodeURIComponent(ep.id)}/sources?${mode}&category=${server.category}${al ? `&al=${al}` : ''}`, { fresh: true });
      if (!alive() || ep !== current) return;
      if (!src.provider) src.provider = server.id;
      // Your own subtitle file for this episode goes to Atlas (EmbedMaster) as sub_url[] / sub_label[].
      const mySub = customSub();
      if (mySub && src.provider === 'embedmaster' && src.embedUrl) {
        src.embedUrl += `${src.embedUrl.includes('?') ? '&' : '?'}sub_url[]=${encodeURIComponent(mySub.url)}&sub_label[]=${encodeURIComponent(mySub.label)}`;
      }
      tried.add(src.provider);
      if (chosenServer) {
        if (src.provider === chosenServer) store.setSetting('provider', chosenServer);
        else if (!note.dataset.sticky) showNote(`${esc(serverName({ id: chosenServer }))} couldn't play this one, so <b>${esc(serverName({ id: src.provider }))}</b> is playing.`);
        chosenServer = null;
      }
      // Reflect the provider that actually resolved, not merely the first one tried.
      if (src.provider) {
        const resolved = servers.find((item) => item.id === src.provider && item.category === server.category);
        if (resolved) server = { id: resolved.id, category: resolved.category };
        renderServers();
      }
      player.load(src, { startAt, meta: { ep: ep.number } });
      updateSpeedBtn();
      // Embedded players can't be told where to start, so say where you left off.
      // A sticky note (missing episode, server switched) stays until the next episode.
      if (note.dataset.sticky) { /* keep it */ }
      else if (src.embedUrl && startAt > 15 && !['vidnest', 'tryembed', 'megaplay', 'vidnext', 'vidcore', 'vidfast', 'vidlink', 'animeembed', 'aniembed'].includes(src.provider)) showNote(`You stopped at <b>${clock(startAt)}</b>. Skip there in the player.`);
      else if (note.querySelector('button') === null) showNote('');
    } catch (err) {
      if (!alive() || ep !== current) return;
      tried.add(server.id);
      // Automatic mode already tried every server in this language on the Worker.
      if (!explicit) servers.filter((s) => s.category === server.category).forEach((s) => tried.add(s.id));
      if (!tryNextServer(`Couldn't load the video: ${err.message}`)) player.msg(`Couldn't load the video: ${err.message}`);
    }
  }
  // Tells the server which episode/server combination failed (no personal data is sent).
  const reported = new Set();
  function report(reason, srv = server) {
    if (!srv) return;
    const key = `${current.number}:${srv.id}:${srv.category}:${reason}`;
    if (reported.has(key)) return;
    reported.add(key);
    fetch('/api/report', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: a.id, ep: current.number, p: srv.id, c: srv.category, r: reason }),
    }).catch(() => {});
  }
  $('report-menu').onclick = (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b) return;
    report(b.dataset.r);
    $('report-menu').open = false;
    $('report-menu').querySelector('summary').textContent = '✓ Reported, thanks';
  };
  const serverName = (s) => servers.find((x) => x.id === s?.id)?.name || s?.id || 'another server';

  // The video failed after it was handed to the player: move to the next server in the same
  // language once. Returns false when nothing is left, so the player shows the error.
  function tryNextServer(message) {
    if (!server || !alive()) return false;
    const failed = server;
    tried.add(failed.id);
    report('auto', failed);
    // Servers that keep failing on this episode lately (struggling) are tried last.
    const untried = (cat) => servers.filter((s) => s.category === cat && !tried.has(s.id))
      .sort((x, y) => Number(Boolean(x.struggling)) - Number(Boolean(y.struggling)))[0];
    let next = untried(failed.category);
    let switchedLanguage = false;
    // No sub server works: the dub beats a dead player (just for this episode; the choice isn't saved).
    if (!next && failed.category === 'sub') {
      next = untried('dub');
      switchedLanguage = Boolean(next);
    }
    if (!next) {
      player.msg(new Set(servers.map((s) => s.id)).size > 1
        ? `${message} No other ${failed.category} server could play it either. You can report it below.`
        : `${message} You can report it below.`);
      return true;
    }
    server = { id: next.id, category: next.category };
    renderServers();
    showNote(switchedLanguage
      ? 'The subtitled copy of this episode isn\'t playing right now, so we switched you to the <b>dub</b>.'
      : `${esc(serverName(failed))} didn't play, switched to <b>${esc(next.name)}</b>.`);
    note.dataset.sticky = '1'; // keep it up while the next server loads
    playSource(player.getCurrentTime(), { explicit: true });
    return true;
  }

  async function goTo(ep) {
    if (!ep) return;
    current = ep;
    range = groupOf(idx());
    history.replaceState(null, '', `/watch/${a.id}?ep=${ep.number}${party ? `&party=${party.code}` : ''}`);
    if (party?.role === 'host') setTimeout(sendPartyState, 800);
    $('crumb-ep').textContent = isMovie(a) ? 'Movie' : epName(ep);
    $('now-ep').textContent = isMovie(a) ? a.title : `${epName(ep)}${ep.isFiller ? ' (filler)' : ''}`;
    $('prev-ep').disabled = idx() === 0;
    $('next-ep').disabled = idx() === episodes.length - 1;
    store.addHistory({ animeId: a.id, ep: ep.number, title: a.title, cover: a.cover });
    lastDuration = 0;
    publishNow();
    showSeen();
    renderEpisodes();
    player.reset();
    tried = new Set();
    delete note.dataset.sticky;
    $('report-menu').querySelector('summary').textContent = '⚑ Report';
    player.busy('Finding a server…');
    $('server-list').innerHTML = '<span class="card-meta">Loading servers…</span>';
    try {
      const data = await api(`/episode/${encodeURIComponent(ep.id)}/servers`);
      if (!alive() || ep !== current) return;
      servers = data.servers;
      const prefs = store.getSettings();
      // This show's own sub/dub choice wins over the general setting.
      const pref = store.showCategory(a.id) || prefs.category;
      // The server that last played this show wins over the general preference.
      // Nothing picked: the first server in the list (the ad-free ones lead).
      const preferredProvider = store.goodServer(a.id, pref) || prefs.provider || '';
      // A server that keeps failing on this episode lately is skipped for the first try.
      const s = servers.find((x) => x.id === preferredProvider && x.category === pref && !x.struggling)
        || servers.find((x) => x.category === pref && !x.struggling)
        || servers.find((x) => x.category === pref)
        || servers[0];
      server = s ? { id: s.id, category: s.category } : null;
      renderServers();
      if (!server) return player.msg('No playback servers are configured for this episode.');
      if (s.category !== pref) $('now-ep').textContent += ` · ${pref} isn't out yet, playing ${s.category}`;
      const p = store.getProgress(a.id);
      // A shared moment (?t=seconds) wins once, on the episode it was shared from.
      const shared = partyAt ?? (sharedAt !== null && ep.number === wantEp ? sharedAt : null);
      sharedAt = null;
      partyAt = null;
      await playSource(shared ?? (p && p.ep === ep.number ? p.time : 0));
    } catch (err) {
      if (alive()) player.msg(`Couldn't load servers: ${err.message}`);
    }
  }

  // ---------- watch party ----------
  // One person hosts; everyone with the invite link follows the host's episode, server, position
  // and pause (where their player allows it). No account needed. The panel under the player shows
  // the invite, who's watching, whether you're really in sync, a chat and reactions.
  const PARTY_KEY = (code) => `animee-space:party:${code}`;
  const NAME_KEY = 'animee-space:party-name';
  const REACTIONS = ['😂', '😮', '❤️', '🔥', '😭', '👏'];
  const partyBar = document.createElement('section');
  partyBar.className = 'party';
  partyBar.hidden = true;
  partyBar.setAttribute('aria-label', 'Watch party');
  document.querySelector('.player-wrap').appendChild(partyBar);
  // Drawn once; updates only change the parts that move (so a half-typed message survives).
  partyBar.innerHTML = `
    <header class="party-head">
      <div class="party-title"><span class="party-dot" aria-hidden="true"></span><b>Watch party</b>
        <button class="party-code" type="button" data-invite title="Copy the invite link"></button></div>
      <div class="party-actions"><button class="btn sm primary" type="button" data-invite>Invite friends</button><button class="btn sm" type="button" data-leave>Leave</button></div>
    </header>
    <p class="party-status" role="status"></p>
    <div class="party-invite" hidden>
      <input class="input" readonly aria-label="Invite link">
      <button class="btn sm" type="button" data-copy>Copy</button>
      <button class="btn sm" type="button" data-share hidden>Share…</button>
      <small>Anyone with this link joins. No account needed.</small>
    </div>
    <div class="party-people" aria-label="Who's watching"></div>
    <div class="party-chat">
      <ol class="party-log" aria-live="polite" aria-label="Party chat"></ol>
      <form class="party-say">
        <input class="input" name="text" maxlength="200" autocomplete="off" placeholder="Message the party…" aria-label="Message the party">
        <button class="btn sm primary" type="submit">Send</button>
      </form>
      <div class="party-react" aria-label="Reactions">${REACTIONS.map((e) => `<button type="button" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}</div>
    </div>`;
  const $p = (sel) => partyBar.querySelector(sel);

  // Your name: your username when signed in, otherwise one you pick (kept in this browser).
  function myName() {
    let n = '';
    try { n = localStorage.getItem(NAME_KEY) || ''; } catch { /* ignore */ }
    if (n) return n;
    if (store.currentUser()?.name) return store.currentUser().name;
    n = `Guest ${Math.floor(100 + Math.random() * 900)}`;
    try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ }
    return n;
  }
  const inviteUrl = () => `${location.origin}/watch/${a.id}?ep=${current.number}&party=${party.code}`;
  const hostOf = () => party?.people?.find((x) => x.host) || null;
  const serverLabel = (id) => servers.find((s) => s.id === id)?.name || id || 'this server';

  function addLine(html, cls = '') {
    const log = $p('.party-log');
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = html;
    log.appendChild(li);
    while (log.children.length > 80) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  const addSystem = (text) => addLine(esc(text), 'sys');

  function renderPeople() {
    const p = party;
    $p('.party-people').innerHTML = (p.people || []).map((x) => {
      const me = x.id === p.you;
      return `<span class="party-person${me ? ' me' : ''}" title="${esc(x.name)}${x.host ? ' (host)' : ''}">
        <i aria-hidden="true">${esc(x.name.slice(0, 1).toUpperCase())}</i>${esc(x.name)}${x.host ? ' <b title="Host">👑</b>' : ''}${me ? ' <small>(you)</small>' : ''}
        ${me ? '<button type="button" class="link-btn" data-rename>Change name</button>' : ''}</span>`;
    }).join('');
  }

  // The one line that says what's actually happening, in plain words.
  function setStatus(text, tone = '') {
    const el = $p('.party-status');
    el.textContent = text;
    el.dataset.tone = tone;
    $p('.party-dot').dataset.tone = tone;
  }
  function renderStatus() {
    const p = party;
    if (!p) return;
    if (p.failed) return setStatus('Couldn’t join: the party may be full or over.', 'bad');
    if (p.ws?.readyState !== 1) return setStatus(p.everOpen ? 'Reconnecting…' : 'Connecting…', 'wait');
    if (p.role === 'host') {
      const n = (p.people || []).length - 1;
      if (!player.hasTime() && p.hostSince && Date.now() - p.hostSince > 20000) {
        return setStatus(`Your server (${serverLabel(server?.id)}) doesn’t share its position, so friends can only follow your episode. For full sync pick ${IS_CINEMEE ? '3ellwa' : '3ellwa, JoJo or Rem'}.`, 'warn');
      }
      return setStatus(n ? `You’re the host. ${n} ${n === 1 ? 'friend follows' : 'friends follow'} your episode, server, position and pause.` : 'You’re the host. Invite friends: they’ll follow your episode, server and position.', 'good');
    }
    const host = hostOf();
    if (!host) return setStatus('The host left. You keep watching on your own until they’re back.', 'warn');
    if (p.sync === 'unknown') return setStatus(`${host.name}’s server doesn’t share its position: you’re on the same episode, skip along by hand.`, 'warn');
    if (p.sync === 'press-play') return setStatus(`Press ▶ in the player to join ${host.name}.`, 'warn');
    if (p.sync === 'manual') return setStatus(`${host.name} is at ${clock(p.hostAt || 0)}. This server can’t be moved for you: skip there in the player.`, 'warn');
    if (p.sync === 'catching-up') return setStatus(`Catching up with ${host.name}…`, 'wait');
    if (p.sync === 'host-paused') return setStatus(`${host.name} paused at ${clock(p.hostAt || 0)}. This server can’t be paused for you: pause your player.`, 'warn');
    return setStatus(`In sync with ${host.name}${p.hostPlaying === false ? ' (paused)' : ''}.`, 'good');
  }
  function renderPartyBar() {
    const p = party;
    if (!p) { partyBar.hidden = true; $('party-btn').hidden = false; return; }
    $('party-btn').hidden = true;
    partyBar.hidden = false;
    $p('.party-code').textContent = p.code;
    renderPeople();
    renderStatus();
  }

  partyBar.addEventListener('keydown', (e) => { if (e.target.matches('input')) e.stopPropagation(); });
  partyBar.onclick = async (e) => {
    const p = party;
    if (!p) return;
    const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
    if (emoji) { floatEmoji(emoji); if (p.ws?.readyState === 1) p.ws.send(JSON.stringify({ type: 'react', emoji })); return; }
    if (e.target.closest('[data-invite]')) { showInvite(); return; }
    if (e.target.closest('[data-copy]')) {
      try { await navigator.clipboard.writeText(inviteUrl()); e.target.textContent = 'Copied ✓'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1500); }
      catch { $p('.party-invite input').select(); }
      return;
    }
    if (e.target.closest('[data-share]')) { navigator.share?.({ title: `Watch ${T(a)} with me`, url: inviteUrl() }).catch(() => {}); return; }
    if (e.target.closest('[data-leave]')) { leaveParty(); return; }
    if (e.target.closest('[data-rename]')) {
      const me = (p.people || []).find((x) => x.id === p.you);
      const chip = e.target.closest('.party-person');
      chip.outerHTML = `<form class="party-rename"><input class="input" name="name" maxlength="20" value="${esc(me?.name || myName())}" aria-label="Your name in the party"><button class="btn sm primary">Save</button></form>`;
      const form = $p('.party-rename');
      form.elements.name.select();
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const name = form.elements.name.value.replace(/\s+/g, ' ').trim().slice(0, 20);
        if (name) { try { localStorage.setItem(NAME_KEY, name); } catch { /* ignore */ } p.ws?.readyState === 1 && p.ws.send(JSON.stringify({ type: 'rename', name })); }
        renderPeople();
      };
    }
  };
  function showInvite() {
    const box = $p('.party-invite');
    box.hidden = false;
    box.querySelector('input').value = inviteUrl();
    box.querySelector('[data-share]').hidden = !navigator.share;
    box.querySelector('input').select();
  }
  $p('.party-say').onsubmit = (e) => {
    e.preventDefault();
    const p = party;
    const input = e.target.elements.text;
    const text = input.value.trim();
    if (!p || !text || p.ws?.readyState !== 1) return;
    if (Date.now() - (p.lastSaid || 0) < 1000) return;
    p.lastSaid = Date.now();
    p.ws.send(JSON.stringify({ type: 'chat', text }));
    addLine(`<b>You</b> ${esc(text)}`, 'mine');
    input.value = '';
  };
  function floatEmoji(emoji) {
    const el = document.createElement('span');
    el.className = 'party-emoji';
    el.textContent = emoji;
    el.style.left = `${10 + Math.random() * 80}%`;
    document.querySelector('.player-wrap').appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // Host: every 3 seconds (and on episode changes) the episode, server, position and pause.
  function sendPartyState() {
    const p = party;
    if (!p || p.role !== 'host' || p.ws?.readyState !== 1) return;
    const known = player.hasTime();
    const t = player.getCurrentTime() || 0;
    const paused = player.isPausedHere();
    const playing = paused === null ? Math.abs(t - p.lastT) > 0.5 : !paused;
    p.lastT = t;
    p.ws.send(JSON.stringify({ type: 'state', show: a.id, ep: current.number, t: known ? t : null, playing, server: server?.id || null, cat: server?.category || 'sub' }));
    renderStatus();
  }
  // Guest: follow the host's show, episode, server, then position and pause.
  function followHost(state) {
    const p = party;
    if (!p || !state) return;
    if (state.show !== String(a.id)) { go(`/watch/${state.show}?ep=${state.ep}&party=${p.code}`); return; }
    p.hostPlaying = state.playing;
    const known = state.t !== null && state.t !== undefined;
    const expected = known ? state.t + (state.playing ? Math.max(0, (Date.now() + (p.skew || 0) - state.at) / 1000) : 0) : null;
    p.hostAt = expected;
    const target = episodes.find((x) => x.number === state.ep);
    if (target && target !== current) {
      addSystem(`${hostOf()?.name || 'The host'} moved to ${epName(target)}.`);
      partyAt = expected;
      p.sync = 'catching-up';
      renderStatus();
      goTo(target);
      return;
    }
    // Same server as the host, so position commands work the same way (once per change).
    const hostServer = state.server && servers.find((s) => s.id === state.server && s.category === state.cat);
    if (hostServer && (server?.id !== hostServer.id || server?.category !== hostServer.category) && p.switchedTo !== `${hostServer.id}:${hostServer.category}`) {
      p.switchedTo = `${hostServer.id}:${hostServer.category}`;
      server = { id: hostServer.id, category: hostServer.category };
      renderServers();
      p.sync = 'catching-up';
      renderStatus();
      playSource(expected ?? player.getCurrentTime(), { explicit: true });
      return;
    }
    if (!known) { p.sync = 'unknown'; renderStatus(); return; }
    const pausable = player.partyPause(!state.playing);
    // The host paused but this server can't be paused from here: don't seek back to the pause
    // point every 3 seconds (that replayed the same second over and over). Say so and wait; when
    // the host plays again the position catches up below.
    if (!state.playing && !pausable) { p.sync = 'host-paused'; renderStatus(); return; }
    const mine = player.getCurrentTime() || 0;
    const started = player.hasTime();
    if (started && Math.abs(expected - mine) <= 4) { p.sync = 'ok'; renderStatus(); return; }
    if (!started && state.playing) {
      // Phones (and some browsers) wait for a tap before playing: say so instead of "in sync".
      p.sync = Date.now() - (p.loadedAt || 0) > 6000 ? 'press-play' : 'catching-up';
      renderStatus();
      return;
    }
    if (player.canFollow()) { player.partySeek(expected); p.sync = 'catching-up'; renderStatus(); return; }
    p.sync = 'manual';
    renderStatus();
  }
  function connectParty() {
    const p = party;
    if (!p || p.closed) return;
    const qs = new URLSearchParams({ name: myName() });
    if (p.hostKey) qs.set('host', p.hostKey);
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/party/${p.code}/ws?${qs}`);
    p.ws = ws;
    ws.onopen = () => { p.retry = 0; p.everOpen = true; renderPartyBar(); };
    ws.onmessage = (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch { return; }
      if (d.now) p.skew = d.now - Date.now();
      if (d.type === 'hello') {
        p.role = d.role;
        p.you = d.you;
        p.people = d.people || [];
        if (p.role === 'host') { p.hostSince = p.hostSince || Date.now(); sendPartyState(); }
        else { p.loadedAt = Date.now(); followHost(d.state); }
        renderPartyBar();
      } else if (d.type === 'roster') {
        const before = new Map((p.people || []).map((x) => [x.id, x.name]));
        const after = new Map((d.people || []).map((x) => [x.id, x.name]));
        for (const [id, name] of after) if (!before.has(id) && id !== p.you) addSystem(`${name} joined.`);
        for (const [id, name] of before) if (!after.has(id)) addSystem(`${name} left.`);
        for (const [id, name] of after) if (before.has(id) && before.get(id) !== name) addSystem(`${before.get(id)} is now ${name}.`);
        p.people = d.people || [];
        renderPartyBar();
      } else if (d.type === 'state' && p.role === 'guest') followHost(d.state);
      else if (d.type === 'react') floatEmoji(d.emoji);
      else if (d.type === 'chat') addLine(`<b>${esc(d.name)}${d.host ? ' 👑' : ''}</b> ${esc(d.text)}`);
    };
    ws.onclose = () => {
      if (p.closed || party !== p) return;
      p.ws = null;
      p.retry = (p.retry || 0) + 1;
      // Never connected after a few tries: the party is full (20 people) or gone.
      if (!p.everOpen && p.retry >= 4) { p.failed = true; renderPartyBar(); return; }
      renderPartyBar();
      setTimeout(connectParty, Math.min(15000, 1000 * 2 ** p.retry));
    };
  }
  function startParty(code, hostKey) {
    party = { code, hostKey: hostKey || '', role: hostKey ? 'host' : 'guest', people: [], ws: null, lastT: 0, skew: 0, closed: false, sync: 'catching-up' };
    $p('.party-log').innerHTML = '';
    $p('.party-invite').hidden = true;
    renderPartyBar();
    connectParty();
  }
  function leaveParty() {
    if (!party) return;
    party.closed = true;
    try { party.ws?.close(); } catch { /* ignore */ }
    party = null;
    history.replaceState(null, '', `/watch/${a.id}?ep=${current.number}`);
    renderPartyBar();
  }
  $('party-btn').onclick = () => {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => letters[n % letters.length]).join('');
    const hostKey = crypto.randomUUID().replace(/-/g, '');
    try { sessionStorage.setItem(PARTY_KEY(code), hostKey); } catch { /* ignore */ }
    startParty(code, hostKey);
    history.replaceState(null, '', `/watch/${a.id}?ep=${current.number}&party=${code}`);
    addSystem('Party started. Send the invite link to your friends.');
    showInvite();
    partyBar.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  // State every 3 s; the status line also re-checks itself (e.g. "press play" → "in sync").
  const partyTimer = setInterval(() => { sendPartyState(); if (party?.role === 'guest') renderStatus(); }, 3000);
  let visibleFor = 0;
  const playCounter = setInterval(() => {
    if (document.visibilityState === 'visible') visibleFor += 15;
    if (visibleFor >= 90) { countPlay(a.id); clearInterval(playCounter); }
  }, 15000);
  onCleanup(() => clearInterval(playCounter));
  onCleanup(() => {
    clearInterval(partyTimer);
    if (party) { party.closed = true; try { party.ws?.close(); } catch { /* ignore */ } party = null; }
  });
  const joinCode = String(query.get('party') || '').toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(joinCode)) {
    let key = '';
    try { key = sessionStorage.getItem(PARTY_KEY(joinCode)) || ''; } catch { /* ignore */ }
    startParty(joinCode, key);
  }

  goTo(current);
  // ?ep=999 on a 24-episode show: say so instead of silently playing another episode.
  if (missingEp) {
    showNote(`Episode ${esc(String(missingEp))} isn't out or doesn't exist, so this is Episode ${current.number}.`);
    note.dataset.sticky = '1';
  }
}
