// my space: animee, cinemee and mangee in one desktop app.
//
// - One window that shows the live sites (so the app is always as new as the website).
// - Discord presence built in: the pages publish what's playing in #now-playing
//   (public/js/nowplaying.js); preload.js reads it, discord.js shows it.
// - Ads and trackers blocked with Ghostery's engine (EasyList-style lists, like Brave).
// - Updates itself from GitHub releases (3ellwa/Animee-space).
//
// MYSPACE_URL=http://localhost:8787 npm start  runs it against a local `npm run dev`.

const { app, BrowserWindow, Menu, shell, ipcMain, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const discord = require('./discord');
const adblock = require('./adblock');

const SITES = process.env.MYSPACE_URL
  ? { animee: process.env.MYSPACE_URL, cinemee: process.env.MYSPACE_URL.replace('//localhost', '//cinemee.localhost'), mangee: process.env.MYSPACE_URL.replace('//localhost', '//mangee.localhost') }
  : { animee: 'https://animee.space', cinemee: 'https://cinemee.animee.space', mangee: 'https://mangee.animee.space' };

/** Our own pages: animee.space and its subdomains (and localhost while developing). */
function isOurs(url) {
  try {
    const u = new URL(url);
    if (process.env.MYSPACE_URL && /(^|\.)localhost$/.test(u.hostname)) return true;
    return u.protocol === 'https:' && (u.hostname === 'animee.space' || u.hostname.endsWith('.animee.space'));
  } catch { return false; }
}
const isWeb = (url) => /^https?:\/\//i.test(url);

// ---------- settings (window size, last page, switches) ----------
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let state = { bounds: { width: 1280, height: 800 }, maximized: false, lastUrl: '', discord: true, adblock: true };
function loadState() {
  try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile(), 'utf8')) }; } catch { /* first run */ }
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch { /* ignore */ } }, 500);
}

// Some video players refuse browsers that say "Electron": look like plain Chrome.
app.userAgentFallback = app.userAgentFallback
  .replace(/ Electron\/\S+/, '')
  .replace(/(\(KHTML, like Gecko\)) .*?(Chrome\/)/, '$1 $2');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    ...state.bounds,
    minWidth: 380,
    minHeight: 500,
    backgroundColor: '#0b0d0a',
    autoHideMenuBar: true,
    title: 'my space',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (state.maximized) win.maximize();

  const start = state.lastUrl && isOurs(state.lastUrl) ? state.lastUrl : SITES.animee;
  win.loadURL(start);

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    state.maximized = win.isMaximized();
    if (!state.maximized && !win.isFullScreen()) state.bounds = win.getBounds();
    saveState();
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.webContents.on('did-navigate', (_e, url) => { if (isOurs(url)) { state.lastUrl = url; saveState(); } });
  win.webContents.on('did-navigate-in-page', (_e, url, isMain) => { if (isMain && isOurs(url)) { state.lastUrl = url; saveState(); } });

  // Leaving our sites: never inside the app. Links you click go to your normal browser
  // (preload.js sends those); anything else trying to take over the window (ad redirects
  // from players) is simply stopped.
  win.webContents.on('will-navigate', (e, url) => { if (!isOurs(url)) e.preventDefault(); });
  win.webContents.on('will-redirect', (e, url) => { if (!isOurs(url)) e.preventDefault(); });
  // New windows: our own pages open here; pop-ups (ads) are refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) win.loadURL(url);
    return { action: 'deny' };
  });

  // Mouse back/forward buttons.
  win.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward' && win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
    if (cmd === 'browser-forward' && win.webContents.navigationHistory.canGoForward()) win.webContents.navigationHistory.goForward();
  });

  win.on('closed', () => { win = null; discord.clear(); });
}

// ---------- menu (press Alt to show it) ----------
function buildMenu() {
  const go = (url) => () => win?.loadURL(url);
  const template = [
    {
      label: 'Go',
      submenu: [
        { label: 'animee', accelerator: 'CmdOrCtrl+1', click: go(SITES.animee) },
        { label: 'cinemee', accelerator: 'CmdOrCtrl+2', click: go(SITES.cinemee) },
        { label: 'mangee', accelerator: 'CmdOrCtrl+3', click: go(SITES.mangee) },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Alt+Left', click: () => win?.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => win?.webContents.navigationHistory.goForward() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
        { label: 'Reload', accelerator: 'F5', visible: false, click: () => win?.webContents.reload() },
        { type: 'separator' },
        { label: 'Open this page in my browser', click: () => { const u = win?.webContents.getURL(); if (u && isWeb(u)) shell.openExternal(u); } },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen', accelerator: 'F11' },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Show what I watch on Discord', type: 'checkbox', checked: state.discord,
          click: (item) => { state.discord = item.checked; saveState(); if (!state.discord) discord.clear(); },
        },
        {
          label: 'Block ads and trackers', type: 'checkbox', checked: state.adblock,
          click: (item) => { state.adblock = item.checked; saveState(); adblock.setEnabled(session.defaultSession, state.adblock); win?.webContents.reload(); },
        },
        { type: 'separator' },
        { label: 'Check for updates', click: () => updates.check(true) },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- messages from the pages (preload.js) ----------
ipcMain.on('now-playing', (e, data) => {
  if (!win || e.sender !== win.webContents || !isOurs(e.senderFrame?.url || '')) return;
  if (state.discord) discord.show(data); else discord.clear();
});
ipcMain.on('open-external', (e, url) => {
  if (!win || e.sender !== win.webContents || !isOurs(e.senderFrame?.url || '')) return;
  if (isOurs(url)) win.loadURL(url);
  else if (isWeb(url)) shell.openExternal(url);
});

// ---------- updates ----------
const updates = require('./updates');

// ---------- start ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    loadState();
    buildMenu();
    await adblock.start(session.defaultSession, path.join(app.getPath('userData'), 'adblock.bin'), state.adblock)
      .catch((err) => console.error('ad blocker failed to start:', err));
    createWindow();
    discord.start();
    updates.start(() => win, dialog);
  });
  app.on('window-all-closed', () => { discord.stop(); app.quit(); });
}
