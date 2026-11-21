// Browser smoke tests: every main page of both sites opens, draws its content and throws no
// uncaught errors. They drive the Chrome (or Edge) already installed on this machine.
//
//   npm run dev                 (in another terminal: wrangler dev on port 8787)
//   npm run test:browser        (BASE / CINEMEE_BASE override the addresses)
//
// They use the live catalogues through the local Worker, so a slow upstream can make one fail;
// run again before assuming a real bug. Player contents (third-party iframes) are not checked.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8787';
const CINEMEE = process.env.CINEMEE_BASE || 'http://cinemee.localhost:8787';
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let browser;
before(async () => {
  const executablePath = BROWSERS.find((p) => existsSync(p));
  assert.ok(executablePath, 'No Chrome or Edge found: set CHROME_PATH');
  browser = await chromium.launch({ executablePath, headless: true, args: ['--host-resolver-rules=MAP cinemee.localhost 127.0.0.1'] });
});
after(async () => { await browser?.close(); });

/** Opens a page and returns it with the uncaught errors seen while it loaded. */
async function open(url, { wait = 'h1, h2, .page-title, .empty', timeout = 20000 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForSelector(wait, { timeout });
  return { page, errors, close: () => context.close() };
}
async function check(url, selector, { text, wait } = {}) {
  const { page, errors, close } = await open(url, wait ? { wait } : {});
  try {
    await page.waitForSelector(selector, { timeout: 20000 });
    if (text) assert.match(await page.locator(selector).first().innerText(), text);
    await page.waitForTimeout(500); // let late scripts run
    assert.deepEqual(errors, [], `uncaught errors on ${url}`);
  } finally { await close(); }
}

// ---------- animee ----------
test('animee home: shelves and genres', () => check(BASE + '/', '#home-genres .chip'));
test('animee search page finds Frieren, even misspelled', () => check(BASE + '/search?q=frirean', '.grid .card', { text: /Frieren/i }));
test('animee title page: rating, list buttons, seasons', () => check(BASE + '/anime/52991/frieren-beyond-journey-s-end', '#my-rating'));
test('animee watch page: servers, episodes, party button', () => check(BASE + '/watch/52991?ep=1', '#server-list .srv', { wait: '#ep-list' }));
test('animee schedule', () => check(BASE + '/schedule', '#sched .sched-row, #sched .empty'));
test('animee A-Z list', () => check(BASE + '/az', '.grid .card, .empty'));
test('animee help me pick', () => check(BASE + '/pick', '.page-title, h1'));
test('animee My list, history and stats', async () => {
  await check(BASE + '/watchlist', '.hub-tabs');
  await check(BASE + '/watchlist?tab=history', '.hub-sub', { text: /history/i });
  await check(BASE + '/stats', '.hub-sub', { text: /stats/i });
});
test('animee settings, account, requests, notifications, admin', async () => {
  await check(BASE + '/settings', '#settings');
  await check(BASE + '/account', '.auth-box');
  await check(BASE + '/requests', '.hub-tabs');
  await check(BASE + '/new', '.hub-tabs');
  await check(BASE + '/admin', '#admin-login');
});
test('a missing page says so', () => check(BASE + '/this/does-not-exist', '.empty', { text: /404/ }));

test('the search box suggests titles as you type', async () => {
  const { page, errors, close } = await open(BASE + '/');
  try {
    await page.fill('#nav-search input', 'jujutsu');
    await page.waitForSelector('#suggest:not([hidden]) a', { timeout: 15000 });
    assert.match(await page.locator('#suggest .s-title').first().innerText(), /Jujutsu/i);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

// ---------- cinemee ----------
test('cinemee home is red and has shelves', async () => {
  const { page, errors, close } = await open(CINEMEE + '/');
  try {
    assert.equal(await page.getAttribute('html', 'data-site'), 'cinemee');
    await page.waitForSelector('#home-genres .chip', { timeout: 20000 });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('cinemee movie page', () => check(CINEMEE + '/movie/5501/fight-club', '#my-rating'));
test('cinemee TV page lists its seasons', () => check(CINEMEE + '/tv/13992/game-of-thrones', '.seasons .season'));
test('cinemee watch page picks episodes season by season (?season=2 opens S2 E1)', async () => {
  const { page, errors, close } = await open(CINEMEE + '/watch/13992?season=2', { wait: '#ep-list .ep' });
  try {
    await page.waitForSelector('#ep-list .ep.on', { timeout: 20000 });
    assert.match(await page.locator('#ep-range option:checked').innerText(), /Season 2/);
    assert.match(await page.locator('#ep-list .ep.on').innerText(), /S2 · E1/);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
test('cinemee schedule', () => check(CINEMEE + '/schedule', '#sched .sched-row, #sched .empty'));
test('cinemee search corrects typos', () => check(CINEMEE + '/search?q=intersteller', '.grid .card', { text: /Interstellar/i }));
