# animee space

Animee.space is a Cloudflare Pages anime catalog and watchlist application.

## Data and playback

- Anime metadata, discovery, search, recommendations and schedules come from AniList.
- Recent additions and full catalog series/episode records can be read through the Anikoto API proxy.
- Playback is embedded from MegaPlay. The player uses the documented AniList-ID endpoint for episodes in the AniList catalog, and can also build legacy HiAnime/Anikoto embed URLs from `episode_embed_id` values.
- MegaPlay is embedded in an iframe. The site does not attempt to extract direct video files or bypass the embed restriction.

## Integrated API routes

All routes are served by the Pages Function under `/api`:

| Route | Purpose |
| --- | --- |
| `GET /api/provider` | Active playback provider |
| `GET /api/anikoto/recent-anime?page=1&per_page=20` | Proxy Anikoto's latest anime catalog (max 50 per page) |
| `GET /api/anikoto/series/:id` | Proxy a full Anikoto series and its `episode_embed_id` values |
| `GET /api/anikoto/embed/:episode_embed_id/:language` | Build a MegaPlay legacy catalog iframe URL (`sub` or `dub`) |
| `GET /api/anime/:id/episodes` | Episode list for an AniList anime id |
| `GET /api/episode/:episodeId/servers` | Sub/dub playback choices |
| `GET /api/episode/:episodeId/sources?server=sub&category=sub` | MegaPlay AniList iframe URL for the selected episode |

MegaPlay embed formats supported by the service:

- Legacy catalog ID: `https://megaplay.buzz/stream/s-2/{episode_embed_id}/{language}`
- MAL ID: `https://megaplay.buzz/stream/mal/{mal_id}/{episode_number}/{language}`
- AniList ID: `https://megaplay.buzz/stream/ani/{anilist_id}/{episode_number}/{language}`

The current watch UI uses the AniList endpoint because the site's primary discovery and detail pages are AniList-based. The Anikoto proxy routes expose recent catalog data and series records, including legacy embed IDs, for catalog-driven pages or future UI additions.

## Player events

The embedded player posts `time`, `complete`, `error`, and `watching-log` messages. `public/js/player.js` accepts messages only when both the iframe window and origin match `https://megaplay.buzz`. Playback progress is forwarded to the existing local/account sync store. Completion marks the episode watched and triggers the site's auto-next setting.

MegaPlay controls playback inside its iframe. As a result, the site's native HLS quality selector, subtitle selector, intro skip, and seeking/resume controls are not available for embedded streams. The embedded player provides its own playback controls. Progress tracking and auto-next work from the documented postMessage events.

## Features

- Home discovery, search and filters, anime details, characters, related titles and recommendations
- Episode lists, sub/dub embed selection, MegaPlay iframe playback and player-event tracking
- Watchlist statuses, continue watching, watched episode markers and airing schedule
- Optional username/password accounts with D1-backed sync across devices
- Local-first storage; account sync batches changes to reduce D1 writes
- Noindex headers and robots policy while the site is in development

## Run locally

```bash
npm install
npx wrangler d1 create animee-space
# Paste the database_id into wrangler.toml
npx wrangler d1 migrations apply animee-space --local
cp .dev.vars.example .dev.vars
# Replace SESSION_SECRET with a long random value
npm run dev
```

Open `http://localhost:8788`.

## Deploy

```bash
npx wrangler login
npx wrangler d1 migrations apply animee-space --remote
npx wrangler pages secret put SESSION_SECRET
npm run deploy
```

Connect `animee.space` as a custom domain in Cloudflare Pages.

## Project structure

```text
functions/
  api/[[path]].js          API routes and edge caching
  _lib/anilist.js          AniList GraphQL client
  _lib/auth.js             password hashing and signed sessions
  _lib/account.js          account and sync routes
  _lib/providers/anikoto.js Anikoto catalog proxy and MegaPlay playback URLs
public/
  index.html
  css/style.css
  js/app.js
  js/api.js
  js/player.js
  js/store.js
migrations/                D1 schema
```
