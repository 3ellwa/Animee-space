# animee space

Animee.space is a Cloudflare Worker application. It serves the frontend and API from one Worker, with D1 for accounts and cross-device library sync.

## Catalogue and playback

- Anime discovery, full-catalogue title search, metadata, and episode listings use the Tenrai API, which follows the Jikan v4 response schema.
- Strict safe-for-work filtering is enabled on catalogue requests and mature details are rejected server-side.
- Video playback uses MegaPlay's documented MAL-ID + episode-number embed route.
- Animee embeds the provider player. Pause, seek, subtitles, and quality controls remain inside that embedded player.
- Not every title is mapped by MegaPlay, so a catalogue match does not guarantee a working embed.

## Features

- Seasonal discovery and searchable catalogue with genre filters
- Anime details, related titles, episode selection, and sub/dub selection
- MegaPlay embedded playback with progress tracking and auto-next
- Watchlist statuses, continue watching, and watched episode markers
- Optional username/password accounts with D1-backed sync across devices
- Local-first storage and batched account sync

## Local development

```bash
npm install
npx wrangler dev
```

Create a `.dev.vars` file containing a long random `SESSION_SECRET` for local account testing.

## Deploy

```bash
npm run deploy
```

The production Worker is `animee-space`. Its D1 binding is `DB`.

## Project structure

```text
worker.js                 Worker entry point and static asset handler
worker-assets.js          Generated static asset bundle
functions/api/[[path]].js API routes
functions/_lib/providers/tenrai.js  Tenrai + MegaPlay integration
public/                   Frontend HTML, CSS and JavaScript
migrations/               D1 schema
```

When changing files under `public/`, regenerate `worker-assets.js` from those files before deploying.
