# animee space

Animee.space is a Cloudflare Worker application. It serves the static frontend and API from one Worker.

## Data and playback

- Anime metadata, discovery, search, recommendations and schedules come from AniList.
- Recent additions and full catalog series/episode records can be read through the Anikoto API proxy.
- Playback is embedded from MegaPlay. The player uses the AniList-ID endpoint for episodes in the AniList catalog.
- The player embeds the provider's player. It does not extract direct video files or bypass embed restrictions.

## API routes

- `GET /api/provider`
- `GET /api/home`
- `GET /api/search?q=&genre=&year=&season=&format=&status=&sort=&page=`
- `GET /api/anime/:id`
- `GET /api/anime/:id/episodes`
- `GET /api/episode/:episodeId/servers`
- `GET /api/episode/:episodeId/sources?server=&category=`
- `GET /api/schedule?start=&end=`
- `GET /api/batch?ids=1,2,3`
- `/api/auth/*` and `/api/me/*` for accounts and library sync
- `/api/anikoto/*` for Anikoto catalog proxy routes

## Features

- Home discovery, search and filters, anime details, characters, related titles and recommendations
- Episode lists, sub/dub selection, embedded playback and player-event tracking
- Watchlist statuses, continue watching, watched episode markers and airing schedule
- Optional username/password accounts with D1-backed sync across devices
- Local-first storage and batched account sync
- Noindex headers and robots policy

## Local development

```bash
npm install
npx wrangler dev
```

The Worker uses the existing D1 database configured in `wrangler.toml`. For local account testing, create a `.dev.vars` file containing a long random `SESSION_SECRET`.

## Deploy

```bash
npx wrangler secret put SESSION_SECRET
npm run deploy
```

The production Worker is `animee-space`. Its D1 binding is `DB`, and `PROVIDER` is set to `anikoto`.

## Project structure

```text
worker.js                 Worker entry point and static asset handler
worker-assets.js          Generated static asset bundle
functions/api/[[path]].js API routes
functions/_lib/           AniList, accounts, auth and provider modules
public/                   Source HTML, CSS, JavaScript and static files
migrations/               D1 schema
```

When changing files under `public/`, regenerate `worker-assets.js` from those files before deploying. The Worker serves the generated bundle directly, so it does not need a separate Pages project.
