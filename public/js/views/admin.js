// Split out of app.js (see app.js for the router and shared helpers).
import { api } from '../api.js';
import * as store from '../store.js';
import { Player } from '../player.js';
import * as inbox from '../inbox.js';
import * as push from '../push.js';
import * as aniList from '../anilist.js';
import { BRAND, IS_CINEMEE, SIBLING } from '../site.js';
import { T, app, card, esc, loader, route, section } from '../app.js';
import { KIND_LABEL, fmtWhen } from './hub.js';

// ---------- admin (hidden; needs the ADMIN_KEY secret) ----------
export function viewAdmin() {
  document.title = `Admin · ${BRAND.title}`;
  const KEY = 'animee-space:admin-key';
  const getKey = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
  const forget = () => { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
  const call = async (path, body) => {
    const r = await fetch('/api/admin/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-Admin-Key': getKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Failed (${r.status})`), { status: r.status });
    return d;
  };
  const askKey = (message = '') => {
    app.innerHTML = `<div class="auth-box"><h1 class="page-title" style="margin-top:0">admin</h1>
      <form id="admin-login"><label class="field"><span>Admin key</span><input class="input" type="password" name="key" autocomplete="off" required></label>
      <div class="actions"><button class="btn primary">Open</button></div><p class="card-meta">${esc(message)}</p></form></div>`;
    document.getElementById('admin-login').onsubmit = (e) => {
      e.preventDefault();
      try { sessionStorage.setItem(KEY, e.target.elements.key.value); } catch { /* ignore */ }
      load();
    };
  };
  const REASONS = ['auto switch', 'won\'t play', 'wrong episode', 'subtitles', 'audio', 'other'];
  const load = async () => {
    if (!getKey()) return askKey();
    app.innerHTML = loader();
    let data;
    try { data = await call('requests'); } catch (err) {
      if (err.status === 401 || err.status === 429) forget();
      return askKey(err.message);
    }
    const open = data.requests.filter((r) => !r.answer).length;
    app.innerHTML = `<h1 class="page-title">admin</h1>
      <p class="card-meta">${open} open request${open === 1 ? '' : 's'} · ${data.requests.length} shown. <button class="link-btn" id="admin-out" type="button">Forget key</button></p>
      <section class="section"><div class="section-head"><h2>site notice</h2></div>
        <form class="card-box" id="notice-form">
          <p class="card-meta">A banner on every page of ${esc(BRAND.title)} until it expires or the visitor closes it. Leave the text empty and save to remove it.${data.notice ? ` <b>Showing now${data.notice.until ? `, until ${new Date(data.notice.until * 1000).toLocaleString()}` : ''}.</b>` : ' Nothing is showing.'}</p>
          <label class="field"><span>Text</span><textarea class="input" name="text" rows="2" maxlength="280" placeholder="e.g. Server 3ellwa is having trouble tonight, use JoJo.">${esc(data.notice?.text || '')}</textarea></label>
          <div class="filter-row">
            <label class="field"><span>Style</span><select class="input" name="level"><option value="info">Info</option><option value="warn"${data.notice?.level === 'warn' ? ' selected' : ''}>Warning</option></select></label>
            <label class="field"><span>Link (optional)</span><input class="input" name="link" placeholder="/requests or https://…" value="${esc(data.notice?.link || '')}"></label>
            <label class="field"><span>Hide after (hours, empty = never)</span><input class="input" name="hours" type="number" min="0" step="1" inputmode="numeric"></label>
          </div>
          <div class="actions"><button class="btn sm primary" type="submit">Save notice</button><span class="card-meta" data-out></span></div>
        </form></section>
      <section class="section"><div class="section-head"><h2>playback reports (7 days)</h2></div>
        ${data.reports.length ? `<table class="admin-table"><tr><th>Server</th><th>Audio</th><th>Reason</th><th>Count</th></tr>
          ${data.reports.map((r) => `<tr><td>${esc(r.provider)}</td><td>${r.cat ? 'dub' : 'sub'}</td><td>${REASONS[r.reason] || r.reason}</td><td>${r.n}</td></tr>`).join('')}</table>`
          : '<p class="card-meta">No reports in the last 7 days.</p>'}</section>
      <section class="section"><div class="section-head"><h2>servers tried last right now</h2></div>
        <p class="card-meta">From the reports: 2+ on one episode in 3 days, or 3+ episodes of a show within 2 days. Clear a false alarm and that server goes back to its normal place (within 10 minutes everywhere).</p>
        ${data.demoted?.length ? `<table class="admin-table" id="demoted"><tr><th>Title</th><th>Where</th><th>Server</th><th>Reports</th><th></th></tr>
          ${data.demoted.map((d) => `<tr data-anime="${esc(d.anime)}" data-ep="${d.ep ?? ''}" data-provider="${esc(d.provider)}" data-category="${esc(d.category)}">
            <td><a href="/anime/${esc(d.anime)}" data-title="${esc(d.anime)}">#${esc(d.anime)}</a></td><td>${d.ep ? `episode ${d.ep}` : '<b>whole show</b>'}</td>
            <td>${esc(d.provider)} ${esc(d.category)}</td><td>${d.n}</td><td><button class="btn sm" type="button" data-clear>Clear</button></td></tr>`).join('')}</table>`
          : '<p class="card-meta">Nothing is demoted right now.</p>'}</section>
      <section class="section"><div class="section-head"><h2>errors (7 days)</h2></div>
        <p class="card-meta">API answers that failed (5xx, per route) and pages that crashed in visitors' browsers, per day.</p>
        ${data.errors?.length ? `<table class="admin-table"><tr><th>Day</th><th>Kind</th><th>Where</th><th>Count</th></tr>
          ${data.errors.map((e) => `<tr><td>${new Date(e.day * 86400000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</td><td>${esc(e.kind)}</td><td>${esc(e.place)}</td><td>${e.n}</td></tr>`).join('')}</table>`
          : '<p class="card-meta">No errors in the last 7 days.</p>'}</section>
      <section class="section"><div class="section-head"><h2>requests</h2></div>
        ${data.requests.map((q) => `<div class="req-item card-box" data-id="${q.id}">
          <div class="card-meta">#${q.id} · ${esc(KIND_LABEL[q.kind] || q.kind)} · ${fmtWhen(q.created)}${q.anime ? ` · <b>${esc(q.anime)}</b>` : ''}</div>
          <p>${esc(q.message)}</p>
          <textarea class="input" rows="2" maxlength="2000" placeholder="Your answer (shown to them)">${esc(q.answer || '')}</textarea>
          <div class="actions"><button class="btn sm primary" data-act="answer" type="button">${q.answer ? 'Update answer' : 'Send answer'}</button>
            <button class="btn sm" data-act="delete" type="button">Delete</button><span class="card-meta" data-out></span></div>
        </div>`).join('') || '<p class="card-meta">No requests yet.</p>'}</section>`;
    document.getElementById('admin-out').onclick = () => { forget(); askKey(); };
    // Titles for the demoted list, six at a time.
    const titleIds = [...new Set((data.demoted || []).map((d) => d.anime))];
    for (let i = 0; i < titleIds.length; i += 6) {
      api(`/batch?ids=${titleIds.slice(i, i + 6).join(',')}`).then(({ results }) => {
        for (const t of results || []) app.querySelectorAll(`[data-title="${t.id}"]`).forEach((el) => { el.textContent = T(t); });
      }).catch(() => {});
    }
    app.querySelectorAll('#demoted [data-clear]').forEach((b) => b.onclick = async () => {
      const row = b.closest('tr');
      const { anime, ep, provider, category } = row.dataset;
      b.disabled = true;
      try {
        await call('undemote', { anime, ep: ep ? Number(ep) : null, provider, category });
        row.remove();
      } catch (err) { b.disabled = false; b.textContent = err.message; }
    });
    document.getElementById('notice-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const out = e.target.querySelector('[data-out]');
      try {
        const { notice } = await call('notice', { text: f.text.value, level: f.level.value, link: f.link.value, hours: f.hours.value ? Number(f.hours.value) : null });
        out.textContent = notice ? 'Saved ✓ (visitors see it within a minute)' : 'Removed ✓';
      } catch (err) { out.textContent = err.message; }
    };
    app.querySelectorAll('.req-item [data-act]').forEach((b) => b.onclick = async () => {
      const item = b.closest('.req-item');
      const id = Number(item.dataset.id);
      const out = item.querySelector('[data-out]');
      try {
        if (b.dataset.act === 'delete') {
          if (!confirm('Delete this request?')) return;
          await call('delete', { id });
          item.remove();
        } else {
          await call('answer', { id, answer: item.querySelector('textarea').value });
          out.textContent = 'Saved ✓';
        }
      } catch (err) { out.textContent = err.message; }
    });
  };
  load();
}
