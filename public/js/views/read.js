// mangee's reader: /watch/<id>?ep=N (and /read/<id>?ep=N) on mangee.animee.space.
//
// Chapters come from MangaDex through our server; their pages through our image proxy.
// Two ways to read: one long column you scroll (default, best on phones) or one page at a time
// (tap the sides, or ← →). Your place is saved as the chapter and the page, so "Continue
// reading" and other devices open the exact page. Each chapter credits its scanlation group.
//
// Settings (this browser): readerMode 'scroll' | 'pages', mangaQuality 'data-saver' | 'data',
// mangaLang 'en' | 'ar' | 'ar,en' (Arabic where there is one, else English).

import { api } from '../api.js';
import * as store from '../store.js';
import { BRAND } from '../site.js';
import { setNowPlaying, clearNowPlaying } from '../nowplaying.js';
import { app, esc, T, animeHref, onCleanup, toastNote, countPlay, viewNotFound, loader } from '../app.js';

export async function viewRead(id, query, alive) {
  if (!/^\d{1,12}$/.test(String(id || ''))) return viewNotFound();
  const settings = store.getSettings();
  const lang = ['en', 'ar', 'ar,en'].includes(settings.mangaLang) ? settings.mangaLang : 'en';
  app.innerHTML = `<div class="reader-loading">${loader()}</div>`;

  const [a, data] = await Promise.all([api(`/anime/${id}`), api(`/anime/${id}/episodes?lang=${encodeURIComponent(lang)}`)]);
  if (!alive()) return;
  const chapters = data.episodes || [];
  document.title = `Read ${T(a)} · ${BRAND.title}`;
  if (!chapters.length) {
    app.innerHTML = `<div class="empty"><h2>No chapters to read here</h2>
      <p>${lang === 'en' ? 'This series has no English chapters on MangaDex, usually because it’s officially licensed.' : 'No chapters in your chosen language. You can change it in Settings.'}</p>
      <p class="actions" style="justify-content:center">${a.officialUrl ? `<a class="btn primary" href="${esc(a.officialUrl)}" target="_blank" rel="noopener">Read it officially ↗</a>` : ''}
      <a class="btn" href="${animeHref(a)}">Back to ${esc(T(a))}</a> <a class="btn" href="/settings">Settings</a></p></div>`;
    return;
  }
  const prog = store.getProgress(a.id);
  const want = Number(query.get('ep')) || prog?.ep || 1;
  let current = chapters.find((c) => c.number === want) || chapters[0];
  let mode = settings.readerMode === 'pages' ? 'pages' : 'scroll';
  let quality = settings.mangaQuality === 'data' ? 'data' : 'data-saver';
  let pages = [];
  let page = 0;          // the page you're on (0-based)
  let retried = false;   // page addresses expire after ~15 minutes: fetch fresh ones once

  app.innerHTML = `
    <div class="crumbs"><a href="/">Home</a> › <a href="${animeHref(a)}">${esc(T(a))}</a> › <span id="rd-crumb"></span></div>
    <div class="reader" id="reader">
      <header class="rd-bar">
        <div class="rd-title"><a href="${animeHref(a)}">${esc(T(a))}</a><b id="rd-ch"></b><small id="rd-credit"></small></div>
        <div class="rd-controls">
          <button class="btn sm" type="button" id="rd-prev">‹ Prev</button>
          <select class="rd-select" id="rd-select" aria-label="Chapter">${chapters.map((c) => `<option value="${c.number}">${esc(c.label)}${c.title && !/^Chapter /.test(c.title) ? ` · ${esc(c.title)}` : ''}</option>`).join('')}</select>
          <button class="btn sm primary" type="button" id="rd-next">Next ›</button>
          <button class="btn sm" type="button" id="rd-mode" title="Switch between one long column and one page at a time"></button>
          <button class="btn sm" type="button" id="rd-quality" title="Smaller images load faster and use less data"></button>
        </div>
      </header>
      <div class="rd-pages" id="rd-pages"></div>
      <div class="rd-end" id="rd-end" hidden></div>
    </div>`;
  const $ = (x) => document.getElementById(x);

  function label() {
    $('rd-crumb').textContent = current.label;
    $('rd-ch').textContent = `${current.label}${current.title && !/^Chapter /.test(current.title) ? ` · ${current.title}` : ''}`;
    $('rd-credit').innerHTML = `${current.groups?.length ? `Scanlated by <b>${current.groups.map(esc).join(', ')}</b> · ` : ''}via <a href="https://mangadex.org/chapter/${esc(current.chapterId)}" target="_blank" rel="noopener">MangaDex</a>${current.lang === 'ar' ? ' · العربية' : ''}`;
    $('rd-select').value = String(current.number);
    const i = chapters.indexOf(current);
    $('rd-prev').disabled = i <= 0;
    $('rd-next').disabled = i >= chapters.length - 1;
    $('rd-mode').textContent = mode === 'scroll' ? '⇕ Scroll' : '▭ Pages';
    $('rd-quality').textContent = quality === 'data-saver' ? 'Data saver' : 'Full quality';
    history.replaceState(null, '', `/watch/${a.id}?ep=${current.number}`);
  }

  // Your place: the chapter and the page (shown as "page N" in Continue reading).
  let saveTimer = 0;
  function saveSpot() {
    // "Now playing" for Discord presence (see nowplaying.js): the chapter and page.
    setNowPlaying({ kind: 'reading', title: T(a), episode: current.label, episodeTitle: current.title && !/^Chapter /.test(current.title) ? current.title : '', number: current.number, time: pages.length ? page + 1 : null, duration: pages.length || null, cover: a.cover, url: animeHref(a) });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.saveProgress({ animeId: a.id, ep: current.number, time: page, duration: pages.length, title: a.title, cover: a.cover });
      if (pages.length && page >= pages.length - 1 && !store.watchedSet(a.id).has(current.number)) store.markWatched(a.id, current.number);
    }, 600);
  }

  // ---------- drawing ----------
  let observer = null;
  function draw(startPage = 0) {
    observer?.disconnect();
    const box = $('rd-pages');
    box.className = `rd-pages ${mode}`;
    if (mode === 'scroll') {
      box.innerHTML = pages.map((src, i) => `<img src="${src}" alt="Page ${i + 1}" data-i="${i}" ${i < 3 ? '' : 'loading="lazy"'} decoding="async">`).join('');
      // The page in the middle of the screen is "the page you're on".
      observer = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { page = Number(e.target.dataset.i); saveSpot(); }
      }, { rootMargin: '-45% 0px -45% 0px' });
      box.querySelectorAll('img').forEach((img) => observer.observe(img));
      if (startPage > 0) requestAnimationFrame(() => box.querySelector(`img[data-i="${startPage}"]`)?.scrollIntoView({ block: 'start' }));
      else window.scrollTo({ top: $('reader').offsetTop - 70 });
    } else {
      page = Math.min(Math.max(0, startPage), pages.length - 1);
      box.innerHTML = `<button class="rd-tap rd-tap-l" type="button" aria-label="Previous page"></button>
        <img id="rd-img" alt="">
        <button class="rd-tap rd-tap-r" type="button" aria-label="Next page"></button>
        <div class="rd-count" id="rd-count"></div>`;
      box.querySelector('.rd-tap-l').onclick = () => turn(-1);
      box.querySelector('.rd-tap-r').onclick = () => turn(1);
      showPage();
    }
    box.querySelectorAll('img').forEach((img) => { img.onerror = () => pageFailed(); });
    $('rd-end').hidden = false;
    const next = chapters[chapters.indexOf(current) + 1];
    $('rd-end').innerHTML = next
      ? `<p>End of ${esc(current.label)}.</p><button class="btn primary" type="button" id="rd-end-next">Next: ${esc(next.label)} ›</button>`
      : `<p>That's the latest chapter here.</p><a class="btn" href="${animeHref(a)}">Back to ${esc(T(a))}</a>`;
    const endNext = $('rd-end-next');
    if (endNext) endNext.onclick = () => openChapter(next);
  }
  function showPage() {
    const img = $('rd-img');
    if (!img) return;
    img.src = pages[page];
    img.alt = `Page ${page + 1}`;
    $('rd-count').textContent = `${page + 1} / ${pages.length}`;
    // Load the next two in the background so turning is instant.
    for (const n of [page + 1, page + 2]) if (pages[n]) { const pre = new Image(); pre.src = pages[n]; }
    saveSpot();
  }
  function turn(step) {
    const n = page + step;
    if (n < 0) { const prev = chapters[chapters.indexOf(current) - 1]; if (prev) openChapter(prev, { atEnd: true }); return; }
    if (n >= pages.length) { const next = chapters[chapters.indexOf(current) + 1]; if (next) openChapter(next); else toastNote('That’s the latest chapter here.'); return; }
    page = n;
    showPage();
    window.scrollTo({ top: $('reader').offsetTop - 70 });
  }

  // ---------- loading a chapter ----------
  async function loadPages() {
    const d = await api(`/episode/${encodeURIComponent(`${a.id}:${current.number}`)}/pages?lang=${encodeURIComponent(lang)}&quality=${quality}`, { fresh: retried });
    return d.pages || [];
  }
  async function openChapter(ch, { atEnd = false, startPage = 0 } = {}) {
    current = ch;
    retried = false;
    label();
    $('rd-pages').innerHTML = loader();
    $('rd-end').hidden = true;
    try {
      pages = await loadPages();
    } catch (err) {
      if (!alive()) return;
      $('rd-pages').innerHTML = `<div class="empty"><p>Couldn't load this chapter: ${esc(err.message)}</p><button class="btn" type="button" id="rd-retry">Try again</button></div>`;
      $('rd-retry').onclick = () => openChapter(ch, { atEnd, startPage });
      return;
    }
    if (!alive() || current !== ch) return;
    page = atEnd ? pages.length - 1 : Math.min(startPage, pages.length - 1);
    draw(page);
    store.addHistory({ animeId: a.id, ep: ch.number, title: a.title, cover: a.cover });
    countPlay(a.id);
    saveSpot();
  }
  async function pageFailed() {
    if (retried) return;
    retried = true; // the page server address expired: ask for fresh addresses, keep your place
    try { pages = await loadPages(); draw(page); } catch { /* leave the broken image */ }
  }

  // ---------- controls ----------
  $('rd-prev').onclick = () => { const p = chapters[chapters.indexOf(current) - 1]; if (p) openChapter(p); };
  $('rd-next').onclick = () => { const n = chapters[chapters.indexOf(current) + 1]; if (n) openChapter(n); };
  $('rd-select').onchange = (e) => openChapter(chapters.find((c) => c.number === Number(e.target.value)) || current);
  $('rd-mode').onclick = () => {
    mode = mode === 'scroll' ? 'pages' : 'scroll';
    store.setSetting('readerMode', mode);
    label();
    draw(page);
  };
  $('rd-quality').onclick = async () => {
    quality = quality === 'data-saver' ? 'data' : 'data-saver';
    store.setSetting('mangaQuality', quality);
    label();
    retried = false;
    try { pages = await loadPages(); draw(page); } catch (err) { toastNote(esc(err.message)); }
  };
  const onKey = (e) => {
    if (e.target.matches?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode === 'pages' && (e.key === 'ArrowRight' || e.key === ' ')) { e.preventDefault(); turn(1); }
    else if (mode === 'pages' && e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
    else if (e.key === 'n' || e.key === 'N') $('rd-next').click();
    else if (e.key === 'p' || e.key === 'P') $('rd-prev').click();
  };
  document.addEventListener('keydown', onKey);
  onCleanup(() => { clearNowPlaying(); document.removeEventListener('keydown', onKey); observer?.disconnect(); clearTimeout(saveTimer); store.sync.flush(); });

  // Start where you stopped (same chapter: same page).
  openChapter(current, { startPage: prog && prog.ep === current.number ? prog.time || 0 : 0 });
}
