import * as tenrai from './tenrai.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

export async function animeMetadata(malId) {
  return tenrai.getAnime(String(malId));
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

function titleScore(left, right) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const edit = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  const aa = new Set(a.split(' '));
  const bb = new Set(b.split(' '));
  const intersection = [...aa].filter(token => bb.has(token)).length;
  const token = intersection / Math.max(aa.size, bb.size);
  return Math.max(edit, token * 0.94);
}

export function chooseAnimeMatch(anime, results, getTitle, getYear = () => null) {
  const knownTitles = [anime.title, anime.titleRomaji, anime.titleNative, ...(anime.synonyms || [])]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (!knownTitles.length) throw fail(502, 'Anime metadata has no usable title for provider matching.');

  const scored = (Array.isArray(results) ? results : []).map(item => {
    const title = String(getTitle(item) || '').trim();
    const year = Number(getYear(item)) || null;
    let score = knownTitles.reduce((best, known) => Math.max(best, titleScore(known, title)), 0);
    if (anime.year && year && Math.abs(Number(anime.year) - year) > 2) score = 0;
    return { item, title, score };
  }).filter(item => item.title).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.78) throw fail(404, 'This title was not confidently matched by the provider.');
  if (scored[1] && best.score - scored[1].score < 0.025) {
    throw fail(404, 'The provider returned multiple similar titles; refusing an uncertain match.');
  }
  return best.item;
}

export function episodeNumber(value) {
  const number = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(number) ? number : null;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(9000),
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; Animee/1.0; +https://animee.space)',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw fail(502, `Provider returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object') throw fail(502, 'Provider returned invalid JSON.');
  return payload;
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'follow',
    signal: options.signal || AbortSignal.timeout(9000),
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw fail(502, `Provider returned HTTP ${response.status}.`);
  return { text: await response.text(), url: response.url || url };
}
