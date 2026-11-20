# animee space

Animee.space is a Cloudflare Worker application. It serves the frontend and API from one Worker, with D1 for accounts and cross-device library sync.

## Catalogue and playback

- Anime discovery, full-catalogue title search, metadata, and episode listings use the Tenrai API, which follows the Jikan v4 response schema.
- Strict safe-for-work filtering is enabled on catalogue requests and mature details are rejected server-side.
- Video playback uses three direct Worker-side adapters: MegaPlay (sub/dub), AnimeParadise (sub), and AniNeko (sub). No Anivexa service or separate backend is required.
- The watch page lists playback providers by language and automatically falls back to the next provider when a source fails.
- Animee embeds the selected provider's player. Pause, seek, subtitles, and quality controls remain inside that embedded player.
- MegaPlay availability checks remain available as a diagnostic, but they no longer disable episodes that may work on another configured provider.

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
- Multi-provider playback (MegaPlay iframe, direct HLS/MP4, and provider embeds) with progress tracking and auto-next
- Watchlist statuses, continue watching, and watched episode markers
- Optional username/password accounts with D1-backed sync across devices
- Local-first storage and batched account sync

## Multiple playback providers

Animee resolves playback directly from its Cloudflare Worker. The built-in providers are:

- **MegaPlay**: sub and dub; its episode page is checked because its unavailable page can still return HTTP 200.
- **AnimeParadise**: sub; uses its own REST API and a restricted HLS proxy route.
- **AniNeko**: sub; searches the catalogue, matches the title against the SFW Tenrai metadata, and resolves the selected episode's player.

Anikoto is intentionally not listed as an independent provider because its current adapter resolves playback through MegaPlay. No `ANIVEXA_API_URL`, separate Node service, or paid aggregator is needed.

Automatic playback tries the saved/preferred provider first, then the other providers in order, stopping at the first valid source. Successful resolutions are cached in memory for two minutes; failed attempts are briefly cached for 15 seconds. Actual availability varies by anime, episode, language, and upstream provider. The provider list is a list of supported adapters, not a guarantee that every adapter has every episode.

To add an additional authorized embed provider, set the Worker variable `ANIMEE_EMBED_PROVIDERS` to a JSON array. Each provider needs a unique `id`, a display `name`, an HTTPS `embedUrlTemplate`, and supported `categories` (`sub`, `dub`, or both).

Template placeholders:
- `{malId}` — MyAnimeList ID for the title
- `{episode}` — episode number
- `{category}` — `sub` or `dub`

Example configuration (replace the example host with an embed URL pattern you are authorized to use):

```json
[
  {
    "id": "backup-one",
    "name": "Backup One",
    "embedUrlTemplate": "https://embed.example/watch/{malId}/{episode}?audio={category}",
    "categories": ["sub", "dub"]
  },
  {
    "id": "backup-two",
    "name": "Backup Two",
    "embedUrlTemplate": "https://player.example/{malId}/{episode}/{category}",
    "categories": ["sub"]
  }
]
```

Configure optional custom providers in Cloudflare Worker Settings → Variables and Secrets, or in the Wrangler `[vars]` section for local testing. Provider embed URLs must be HTTPS. The project does not ship guessed Ryu, Volt, Warp, or Ayame URL patterns: only add a provider when you have a documented, permitted embed URL contract.

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
functions/_lib/providers/tenrai.js  SFW catalogue + MegaPlay embed route
functions/_lib/providers/megaplay.js MegaPlay episode availability checks
functions/_lib/providers/animeparadise.js AnimeParadise playback adapter
functions/_lib/providers/anineko.js AniNeko playback adapter
functions/_lib/providers/matching.js SFW title matching and upstream helpers
functions/_lib/providers/stream-proxy.js Restricted AnimeParadise HLS proxy
functions/_lib/providers/registry.js Multi-provider fallback registry
public/                   Frontend HTML, CSS and JavaScript
migrations/               D1 schema
```

`worker-assets.js` is generated from `public/` by `npm run build` (`scripts/build-assets.mjs`). `npm run dev` and `npm run deploy` run the build first. Security headers (including the Content-Security-Policy) are set in `worker.js`.
