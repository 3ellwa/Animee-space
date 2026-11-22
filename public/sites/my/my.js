// Fills in the newest version and its size, or says it's coming if nothing is released yet.
const btn = document.getElementById('dl');
const meta = document.getElementById('dl-meta');
try {
  const res = await fetch('/latest.json');
  const r = res.ok ? await res.json() : null;
  if (r?.version) {
    const mb = r.size ? ` · ${Math.round(r.size / 1048576)} MB` : '';
    meta.textContent = `Version ${r.version}${mb} · Windows 10 and 11 · 64-bit · free`;
  } else {
    btn.textContent = 'Coming very soon';
    btn.setAttribute('aria-disabled', 'true');
    meta.textContent = 'The first version is on its way.';
  }
} catch { /* keep the plain button: /download still works */ }
