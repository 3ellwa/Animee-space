## VidNest and TryEmbed servers; AniList lookups from the browser

- Two more playback servers, each one entry in sub and dub: **VidNest** (`vidnest.fun`) and **TryEmbed** (`tryembed.us.cc`). Both open at your saved position (`startAt`), so there's no "skip to 11:24" hint for them; TryEmbed's own auto-next is turned off so animee's Up next stays in charge, and its progress messages are accepted only from its exact player window.
- Both address shows by AniList ID. AniList refuses requests from Cloudflare's servers, so the watch page looks the ID up from the browser (remembered for 30 days) and sends it with the playback request (`&al=`). Without it, the Worker tries AniList itself, which works in local development.
- **AniList import fixed**: it failed on the live site ("AniList returned an error") for the same reason. It now runs in the browser; the old `/api/import/anilist` route stays for local use.
- Checked on animee.space: VidNest plays and opens at the saved spot (its player opens pop-up ad tabs on click). VidNest sends no progress messages, so watching there doesn't update saved progress, Continue watching or Up next. TryEmbed plays in normal browsers; it shows "Access denied: bootstrap binding failed" to automated test browsers.

## My anime hub, follow + pop-ups, requests

- **My anime** (`/me`, nav "My Anime" with a new-episode badge): one hub with tabs for Continue, My list, Favourites, History, Notifications, Requests, Stats, Settings and Account, plus a "Five things to know" panel that can be hidden. Settings left the top nav; it lives in the hub.
- **My list filters**: genre, year and airing status next to type and sort. Missing details for older entries are fetched in the background, 6 at a time.
- **🔔 Follow** on airing and upcoming shows (show page and watch page). Followed shows feed Notifications; synced as one more spare bit of the library row. Settings → Episode alerts for: sub and dub, sub only, dub only.
- **Pop-ups (Web Push)**: Settings → Pop-ups on this device (turn on/off, send a test). A scheduled Worker run every 10 minutes checks a few followed shows (one small request each) and wakes followers' devices. Pushes carry no data; the service worker asks the server what's new. Small tables (`push_subs`, `push_follows`, `push_shows`), created automatically; dead devices are removed. Needs `node scripts/setup-push.mjs` once.
- **Requests** (`/requests`): ask for an anime, share an idea or report a problem; answers show up in the same tab (by a per-browser id, and across devices when signed in). Bounded `requests` table (5,000 rows, answered ones kept 90 days), 3 per minute per address.
- **Admin** (`/admin`, hidden): answer or delete requests and see 7 days of playback reports. Locked with the `ADMIN_KEY` secret (`node scripts/set-admin-key.mjs`).
- Notifications: the next episode comes after the last one watched (or, for followed shows not started yet, after what was out when followed), and dismissing moves on to the next one.

## New episodes inbox, airing calendar, stats, clearer loading

- **New for you** (`/new`, nav badge): airing shows on your Watching list whose next episode after the last one you watched is out. Worked out in the browser from your list; the server is only asked the existing edge-cached "does episode N play" question. Checked at most every 30 minutes in the background, with Dismiss and Check now.
- **Airing calendar**: the account page gives a private link (Google Calendar, Apple Calendar, Outlook) with a weekly event per airing show on your Watching and Plan to watch lists, at its Tokyo broadcast time. The link is signed, so nothing is stored; "Sign out everywhere" turns old links off. The feed is edge-cached for 6 hours.
- **My stats** (`/stats`, footer and watchlist links): episodes and hours watched, list counts, top genres weighted by episodes, most watched shows, busiest weekdays and longest streak (from this browser's history), and a summary to copy.
- **Watch page loading**: the page's shape (player, episode panel, the poster when known) appears at once with what's happening ("Getting the show…", "Loading the episode list…", "Syncing your progress…"), and the server list for the likely episode is fetched in parallel.
- **Fewer server failures**: each show remembers the server whose video actually started, so after one failure and an automatic switch, the next episodes start on the working server instead of failing again.
- **Spotlight legibility**: a soft dark pool behind the text, stronger text shadows and a darker art gradient, so bright art never competes with the title or synopsis (checked on all slides, desktop and mobile).
- Local show details now keep airing status, genres and episode length (for the inbox and stats), and merge instead of replacing.

## Up next, per-show audio, automatic list status, shortcuts

- "Up next" card when an episode ends: a 5-second countdown, then the next episode plays (Play now / Cancel). It follows Auto next and Skip filler, says how many filler episodes it skips, and pauses while the tab is hidden.
- Sub or dub is remembered per show (One Piece in dub, Frieren in sub); the general setting is used for shows you haven't chosen for. Stored in two spare bits of the existing library row, so no extra storage.
- List status follows what you watch: 2 minutes into a "Plan to watch" or "On hold" show it moves to Watching; finishing the last episode of a finished show marks it Completed. Each change shows a note with Undo.
- Watch page keys: N next, P previous, W mark watched, F fullscreen (not while the embedded player has focus).
- Sync fix: a change made while an upload was in flight (in the same second) could be overwritten by the upload's reply. Uploads now compare what was sent with what's there now.

## Continue on any device, safer sign-in, self-healing player

- Switch devices mid-episode: the leaving device uploads right away (pause, episode end, leaving the page, switching apps), and the arriving one downloads before choosing the episode and whenever the tab comes back. A page left open on another device offers "Continue there". Sub/dub and the preferred server sync too, and change times use the server's clock so a phone with a wrong clock can't lose newer progress. Storage is unchanged: still one small row per show, overwritten in place.
- Embedded players (MegaPlay) can't be told where to start, so the watch page says "You stopped at 11:24".
- Airing shows without an episode total on MAL (One Piece, Detective Conan) now count their aired episodes, so they show "1180 eps" and a Watch button instead of "Not released yet".
- Sign-in is limited to 10 attempts a minute per address and per username, sign-up to 3 a minute per address (Workers rate limiting bindings, nothing stored).
- Player: a spinner while a server is found and the video starts; if a server fails (error from the player, stream error, or a frame that never loads), the next server in the same language is tried once, with a note saying so.
- Report button on the watch page (won't play, wrong episode, subtitles, audio, other). Reports and automatic server switches are counted in a small D1 `reports` table (one row per episode, server, reason and day; kept 30 days; created automatically). No viewer data is stored.
- `?ep=999` on a shorter show now says the episode isn't out instead of silently playing episode 1.
- Not done: sandboxing the player frame. MegaPlay refuses to play when sandboxed.

## Search engines and quieter browsing

- Real page addresses: `/anime/52991/frieren-beyond-journey-s-end`, `/watch/52991?ep=2`, `/top/popular` instead of `#/…`. Old `#/` links still work and are converted on load; address bars settle on each show's canonical slug.
- The Worker fills in each page's title, description, canonical link, Open Graph and Twitter tags, and JSON-LD (WebSite search box, TVSeries or Movie, breadcrumbs) before sending the page, plus plain-HTML show details for crawlers that don't run scripts.
- `/sitemap.xml` (fixed pages, ranked lists and a few hundred popular, airing and seasonal shows), `/robots.txt` that allows crawling, a 1200x630 share image (`/og.png`), and an IndexNow key for Bing and Yandex.
- Unknown addresses and missing shows return a real 404. Watchlist, settings, account and random pages are `noindex`; API responses carry `X-Robots-Tag: noindex`.
- Harem, Reverse Harem and Magical Sex Shift shows stay out of browsing (home rows, spotlight, lists, schedule, random, genre chips, sitemap) but still appear in title searches and when one of those genres is picked directly.

## Home rows and sharp spotlight

- Spotlight uses each show's wide banner from AniList's free public API (by MAL ID), so the hero is sharp instead of a blurred cover. The visitor's browser asks AniList directly (AniList refuses requests from Cloudflare's servers) and remembers the answers for three days. Shows without a banner, or AniList being down, keep the cover art.
- Home is now a set of horizontal rows with arrow buttons: Because you watched, Top 10 this season (big ranked numbers), Airing now, New this season, Coming soon, Just completed, Most popular, Fan favourites. Each row loads when you scroll near it.
- API cache versions bumped so the new home response replaces cached copies straight away.

## New identity: anim^^.

- Logo: the "ee" in animee became happy eyes, `^^.`. New favicon and app icons (lime mark on ink).
- Colours: night-dark surfaces with one brand colour, Lime, used as glow on buttons, tabs, episodes, posters and the player.
- Type: Bricolage Grotesque for headings and the wordmark, Inter for text, both self-hosted.
- Motion: floating glass nav, glowing scroll progress line, cards that lift and glow under the cursor, a drifting spotlight with a filling progress dot, pages that rise in. Reduced motion is respected.
- Voice: lowercase headings ending in a lime full stop, a blinking ^^. loader, kaomoji empty, error, 404 and offline states, and an idle "still there? ^^." outside the watch page.
- Press "/" to jump to search. Error pages only offer "Try again" when retrying can help.
- Brand guide in `docs/BRAND.md`.

## Audit fixes (November 2026)

- Removed the AniNeko provider: its upstream was down (Cloudflare 522) and every request waited about 18 seconds before failing.
- Playback fallback: 8-second deadline per provider, a 5-minute breaker for providers that keep failing, and HTTP 504 (naming the provider) instead of a generic 500 for timeouts. The MegaPlay availability probe now has a timeout too.
- Watch page: each source gets a new player iframe, so Back leaves the page in one press instead of stepping through old players.
- hls.js is loaded on first HLS playback instead of on every page; the app no longer waits for it before starting.
- Search: misspelled titles ("frerien", "naurto") put close matches first even when the exact search returns unrelated titles.
- Search suggestions close on navigation and Escape, and support arrow keys and Enter.
- Spotlight uses the show's cover art (blurred backdrop plus poster) instead of trailer thumbnails that carried other services' logos.
- Full findings in `docs/AUDIT-2026-11.md`.

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

