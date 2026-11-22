# my space (desktop app)

animee, cinemee and mangee in one Windows app. Download page: https://my.animee.space
(served by the Worker, `functions/_lib/myspace.js` + `public/sites/my/`).

- **Shows the live sites**: the app is a window onto animee.space, so site changes reach it
  on every push, no app update needed. Ctrl+1/2/3 switch sites; Alt shows the menu.
- **Discord presence** (`discord.js`): `preload.js` reads `#now-playing` (published by
  `public/js/nowplaying.js`) every 5 s; the app sends it to the Discord desktop app over IPC.
  Discord application id 1574094254597341214 ("animee").
- **Ad blocker** (`adblock.js`): Ghostery's engine with its prebuilt ads + tracking lists
  (EasyList/EasyPrivacy-style, like Brave), on every request including inside players.
  Our own hosts, MangaDex and TMDB images are always allowed. Settings → Block ads switches it off.
- **Links to other websites** open in your normal browser; pop-ups and redirects from
  players are refused.
- **Updates itself** (`updates.js`, electron-updater): checks GitHub releases of
  3ellwa/Animee-space at start and every 6 h.

## Run from source

```powershell
cd desktop; npm install; node node_modules/electron/install.js; npm start
```

`$env:MYSPACE_URL = 'http://localhost:8787'; npm start` points it at a local `npm run dev`.

## Release a new version

1. Raise `version` in `desktop/package.json` (e.g. 1.0.1).
2. `cd desktop; $env:GH_TOKEN = (gh auth token); npm run release`
   builds `my-space-setup.exe` and publishes GitHub release `v1.0.1` with `latest.yml`.
   Installed apps pick it up within 6 hours; my.animee.space shows it within 10 minutes.

The installer isn't code-signed, so Windows SmartScreen warns on first install
("More info → Run anyway"). A code-signing certificate removes that.
