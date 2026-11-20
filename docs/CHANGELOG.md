## Direct multi-provider playback (no Anivexa)

- Removed the Anivexa service dependency and its adapter.
- Added independent Worker-side AnimeParadise and AniNeko adapters alongside MegaPlay.
- Added SFW title matching before requesting an upstream episode and restricted AnimeParadise HLS proxying to the provider's stream host.
- Automatic playback now tries the preferred provider followed by the remaining providers sequentially, stopping at the first usable source.
- Anikoto is not counted as another provider because its current playback adapter uses MegaPlay.

# Changelog

## Favourites and Not interested

- Detail page: "♡ Favourite" and "Not interested" buttons. Not interested is also a list status in the dropdown.
- Watchlist: "♥ Favourites" and "Not interested" tabs; "All" no longer counts Not interested shows.
- Not interested shows are left out of the spotlight, home rows, Top 10, Help me pick and recommendations (not search or browse).
- Storage: the library `s` column now packs the list status (0-6, 6 = not interested) with a favourite flag (8). No migration needed; the server keeps only valid values (`cleanStatus` in `functions/_lib/account.js`). Imports and "replace" restores keep favourites.

## Real episode availability, full filler guide, new-episode badges

- MegaPlay availability: the server checks which episodes actually stream in sub and dub (binary search over the episode list, about a dozen cached checks per show; `functions/_lib/providers/megaplay.js`). New routes `/anime/:id/availability` and `/anime/:id/available?ep=N`.
- Watch page: episodes that can't stream are greyed out and show a clear message instead of MegaPlay's error page; a language that isn't out is disabled and the other one plays; the episode header shows how many are playable.
- Detail page: "Sub N · Dub N" chip; "Not available to stream yet" when nothing plays.
- Episode lists now fetch every Tenrai page (100 per page), so long shows keep episode names and filler/recap flags (Naruto: 220 named, 89 filler).
- Filler guide under the episode list, recap markers, and a "Skip filler" option (watch page and Settings) that auto next follows.
- Continue watching shows "Episode N is out" when the next episode of a finished one streams, and links straight to it.

## Settings, list tools, A-Z, Help me pick, imports, install as app

- Settings page (`#/settings`): English or Japanese (romaji) titles, show/hide Continue watching, hide started shows from home rows and picks, preferred audio, auto next, wide player, install the app, import, backup and a privacy note.
- Import: AniList by username (public lists, via the new `/api/import/anilist` route) and MyAnimeList export files (.xml or .xml.gz, read in the browser). "Add" or "Replace" only changes list statuses; progress is kept.
- Backup: download the list, progress and history as JSON, and restore it (add or replace).
- Watchlist: search within the list, type filter, four sort orders, 60 at a time with "Show more", and a History tab (every episode opened in this browser; history is not synced).
- A-Z list (`#/az`), Help me pick (`#/pick`: mood, genre, a show you like, length; 12 shuffled picks), studio links on detail pages (`#/search?studio=...`), and "Another random" after Random.
- Schedule: dated tabs from yesterday to five days ahead, "Just my shows", and a box to find a show's next episode.
- Install as an app: web app manifest, PNG icons (drawn by `scripts/make-icons.mjs`), and a service worker that only shows an offline page; nothing is cached. The asset bundle now supports images.
- Search API accepts `letter` and `studio`.

## Shorter browser cache for API responses

- Browsers now keep API responses for at most 10 minutes; the edge cache keeps its own longer lifetimes (up to a day). Deploys reach every visitor within 10 minutes.
- The app adds `v=2` to its API requests (`API_VERSION` in `public/js/api.js`), so browsers skip API copies saved before this change.

## Seasons strip: TV specials and spin-offs

- "TV Special" titles (for example Attack on Titan: The Final Chapters) were dropped because the type became `TVSPECIAL`; it is now `TV_SPECIAL` and shows as "TV Special".
- Spin-offs and recaps are now included in the seasons strip as end points: their own links are not followed. The main prequel/sequel chain is collected first, so the 20-part limit never pushes out a real season.

## Seasons strip and wide player

- Detail and watch pages show "Seasons and movies": every season, movie and side story in watching (release) order, with the current one marked "You are here". Built from prequel/sequel/side-story links (up to 20 parts), cached for a day. "Related" now lists only titles not already in the strip.
- Watch page: the normal player fits the screen height with its controls visible; "Wide player" fills the page width. The choice is remembered in the browser.
- Fixed the detail page column stretching to fit wide content, which could make the page scroll sideways.

## Feature parity pass

- Home: spotlight carousel, shortcut chips, "Because you watched" recommendations, Fresh picks tabs (this season, coming soon, just completed), Top 10 this season, Charts tabs (top airing, most popular, most favourited), and genre chips.
- Browse: type, status, season, year, minimum score, age rating, up to 5 genres (77 available, adult ones excluded), and sort order. Selects apply immediately. Year and season browsing ranks that period's titles by popularity.
- Search: if a title has no exact match, close matches are shown (for example "frirene" finds Frieren).
- New pages: ranked lists (`#/top/...`), weekly airing schedule with local times and countdowns, random title, and type shortcuts (`#/tv`, `#/movies`, `#/ova`, `#/ona`, `#/specials`, `#/airing`, `#/upcoming`).
- Details: labelled seasons and related titles, characters and Japanese voice actors, recommendations, next-episode countdown, themes as genre chips, and a share button.
- Watch: "Mark watched" button and recommendations.
- Accessibility: poster images have alt text and the home page has a main heading.
- API: new `/list/:name`, `/schedule`, `/random`, `/genres` and `/anime/:id/extras` routes; requests to Tenrai are spaced out and retried once on rate limits.

## Fixes from site comparison

- Watch page no longer scrolls the player off-screen on phones; only the episode list scrolls to the current episode.
- Prev and Next are disabled on the first and last episode.
- Choosing a genre applies it straight away, and genre results are ordered by popularity.
- Detail page shows the romaji and Japanese titles once each; cards with an unknown episode count no longer show "? eps".
- Removed the unused hls.js script from the CDN.
- Added Content-Security-Policy, X-Frame-Options, HSTS and Permissions-Policy headers in `worker.js`; removed the unused `public/_headers`.
- Fixed the `worker.js` import path (`functions/api/`) and added `npm run build` to regenerate `worker-assets.js`.

## Tenrai + MegaPlay integration

- Switched the catalogue to the Tenrai v1 API (Jikan v4 schema) for seasonal discovery, full-catalogue search, details and episode listings.
- Anime are now identified by MAL ID; MegaPlay embeds use the `/stream/mal/{mal-id}/{episode}/{sub|dub}` route.
- Enabled strict safe-for-work filtering on catalogue requests and rejected mature details server-side.
- Removed the unused AniList and Anikoto providers, the `providers/index.js` selector, their tests, and the `PROVIDER` variable in `wrangler.toml`. The API route imports the Tenrai provider directly.

## Anikoto + MegaPlay integration

- Replaced demo/mock and unconfigured partner playback providers with the Anikoto + MegaPlay provider.
- Added cached Pages API proxies for recent anime, full series data, and legacy episode embed URL construction.
- Added MegaPlay iframe playback using AniList IDs and sub/dub language paths.
- Added origin- and iframe-validated player event handling for progress, completion, errors and auto-next.
- Removed demo video streams, demo subtitle tracks and the development-only mock provider banner.

