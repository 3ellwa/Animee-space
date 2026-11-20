# animee space

Animee.space is a Cloudflare Worker application. It serves the frontend and API from one Worker, with D1 for accounts and cross-device library sync.

## Catalogue and playback

- Anime discovery, full-catalogue title search, metadata, and episode listings use the Tenrai API, which follows the Jikan v4 response schema.
- Strict safe-for-work filtering is enabled on catalogue requests and mature details are rejected server-side.
- Video playback uses MegaPlay's documented MAL-ID + episode-number embed route.
- Animee embeds the provider player. Pause, seek, subtitles, and quality controls remain inside that embedded player.
- Not every title is mapped by MegaPlay, so a catalogue match does not guarantee a working embed.

## Features

- Home page with spotlight, shortcuts, Top 10, this season / coming soon / just completed, charts, "Because you watched", and genres
- Searchable catalogue with close-match fallback for typos
- Browse filters: type, status, season, year, score, age rating, up to 5 genres, and sort order; shortcuts like `#/tv`, `#/movies`, `#/airing`
- Ranked lists (`#/top/airing`, `popular`, `favorite`, `upcoming`, `season`, `completed`), weekly airing schedule with local times, and random title
- Anime details with seasons and related titles, characters and voice actors, recommendations, next-episode countdown, and share
- Episode selection, sub/dub selection, and manual "mark watched"
- Settings: English or Japanese titles, home page options, player preferences, install as an app
- Import from AniList (username) or a MyAnimeList export file; backup download and restore
- Watchlist search, filters and sorting; watch history; A-Z list; Help me pick
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

Pushing to `main` on GitHub deploys automatically: Cloudflare Workers Builds is connected to this repository, runs `npm run build`, then `npx wrangler deploy`. Check a build under Workers & Pages → animee-space → Deployments in the Cloudflare dashboard.

```bash
git push origin main
```

`npm run deploy` deploys straight from your folder and skips GitHub, so the live site no longer matches the repository. Use it only in an emergency, then push the same commit.

The production Worker is `animee-space`. Its D1 binding is `DB`.

## Project structure

```text
worker.js                 Worker entry point and static asset handler
worker-assets.js          Generated static asset bundle
functions/api/[[path]].js API routes
functions/_lib/providers/tenrai.js  Tenrai + MegaPlay integration (imported directly by the API route)
public/                   Frontend HTML, CSS and JavaScript
migrations/               D1 schema
```

`worker-assets.js` is generated from `public/` by `npm run build` (`scripts/build-assets.mjs`). `npm run dev` and `npm run deploy` run the build first. Security headers (including the Content-Security-Policy) are set in `worker.js`.
