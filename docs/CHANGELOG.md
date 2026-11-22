## Discord presence

- The watch page and the reader publish what's playing as JSON in `<script id="now-playing" type="application/json">` (`public/js/nowplaying.js`): site, title, episode or chapter, season, position, length, paused, cover, link. Updated every 5 s while watching, on every page turn while reading, removed when you leave.
- `integrations/premid/animee/` is a PreMiD activity that turns it into "Watching animee · Frieren · Episode 5 · 12:31 left" (also cinemee and mangee). Needs a Discord application id; steps in `integrations/premid/README.md`.

## One account for every site, and mangee (manga)

- **One account:** accounts live in animee's database (`USERS_DB` in `siteEnv`); each site keeps its own lists and progress in its own database under the same id. The login cookie is now `am_session` with `Domain=animee.space` on the live sites, so signing in once works on all three (old `as_session` cookies no longer count: sign in once more). Deleting an account clears it on every site. The existing cinemee account had the same name and id as the animee one, so nothing needed moving.
- **mangee** (mangee.animee.space, neon yellow `#FFE81F`): manga from MangaDex (`functions/_lib/providers/mangadex.js`, same shape as the other catalogues). MangaDex UUIDs get plain numbers in mangee's own D1 database (`MANGEE_DB`, table `titles`, migration 0005). Home rows only show series with readable English chapters; licensed series are still searchable, marked "No chapters here" with the official link when MangaDex has one.
- **Reader** (`public/js/views/read.js`, at `/watch/<id>?ep=N`): scroll down (default) or one page at a time (tap the sides, ← →), chapter picker, Prev/Next, data saver or full quality, your exact page saved and restored, chapters marked read at the last page, scanlation group credited on every chapter. Settings → Reading: English, Arabic, or both (Arabic first).
- **Images** (`functions/_lib/mdimg.js`, `/api/mdimg?u=`): covers and pages proxied (MangaDex blocks hotlinking), only MangaDex hosts, pages edge-cached by content hash, MangaDex@Home loads reported to api.mangadex.network as their rules ask.
- Also: pop-ups for new chapters (cron), "Continue on…" works between all three sites, search-engine pages for /manga/<id>/<slug>, footer credit to MangaDex.

## Polish: phones, the watch page, small rough edges

- **Phones are a step smaller and calmer:** 14 px text, tighter spacing, compact buttons/chips/tabs (touch targets ≥ 34 px), smaller headlines and spotlight, 16 px inputs (no iOS zoom). One block at the end of style.css.
- **Watch page:** episodes in a sticky sidebar beside the player on wide screens; on narrower screens (and Wide player) straight under the servers instead of after the synopsis. Phones: Prev/Next first, no Wide player, titled episode lists one per row with "…". The keyboard hint is a small "⌨ Shortcuts" label.
- Home "Because you watched" follows the English-titles setting; the rating menu matches the buttons beside it; "Source: Manga" capitalised; "1 episode / 1 season / 1 show" instead of "1 episodes".
- My anime: tips start closed once you have a list; hub and list-status tabs are one swipeable row on phones; the What's new bar is one slim line on phones.

## Watch party, rebuilt

- **Why:** it said "following the host" even when nothing was synced. Guests stayed on their own default server (JoJo/Hoshi can't be moved, so they never followed); a host on a server that doesn't report its time sent "0:00, paused", pulling guests back to the start; phones waiting for a tap looked "in sync".
- **Sync:** guests switch to the host's server automatically; the host's position is only sent when their player reports it (otherwise guests follow the episode and are told to skip by hand); "Press ▶ to join" when a guest's player is waiting for a tap.
- **Panel:** a real party panel under the player: live dot and party code, one plain status line (in sync / catching up / press play / host left / the host's server can't share its position), an invite box with Copy and Share, who's watching (with a crown for the host and "(you)"), change your name (works without an account), a proper chat with "joined / left / moved to episode" lines and an empty state, and reactions under the chat.
- **Room** (`functions/_lib/party.js`): keeps who's connected (display name, host or not) on the open connections and broadcasts the list; chat names come from the connection, not the message; the host's state carries their server and sub/dub.

## Two more anime servers: Rem and Ram

- **Rem** (animeembed.com), second after 3ellwa: MyAnimeList ids, sub/dub, resumes (`start`), its own intro skip, lime accent, progress/ended messages and seek/play/pause commands (so it follows watch parties).
- **Ram** (aniembed.se), last: AniList ids, sub/dub, resumes (`t`), progress every 5 s and seek/play/pause commands.
- The fallback checks Rem and Ram have the show/episode before using them (and counts an unreachable one as an outage); a Rem/Ram player that never says "ready" within 25 s moves on to the next server.
- Fix: the watch-party bar and the speed button showed on every watch page (a `display` rule beat `hidden`); `[hidden]` now always wins.

## Audit fixes, code review fixes, app.js split, browser tests

- From the November audit (most of it was already done): a clicked server only becomes your default once it actually plays, and a note says which one played instead; "Not interested" once on title pages; trailers load on click; recommendation titles follow the English-titles setting; ~40 px tap targets on phones; "Sign in" no longer wraps. Fixed along the way: `split(/s+/)` and `[^p{L}p{N}]` in tenrai.js had lost their backslashes.
- From the code review: backups keep ratings; the other-device check doesn't poll on players that never report time (it pulled the whole library every 45 s); TV season cards open via `?season=N` (the real first episode); Atlas gets literal `sub_url[]`; one SRT converter (on the server); shared lists aren't edge-cached and count every title; a push test keeps a weekly digest's episodes; parties that can't be joined stop retrying; "Script error." isn't counted.
- `public/js/app.js` (3,500 lines) is split: views now live in `public/js/views/` (watch, lists, hub, account, admin, discover, settings).
- Browser smoke tests (`e2e/smoke.e2e.mjs`, 17 tests, both sites): `npm run test:browser`. `docs/CHECKLIST.md` for the hands-on part.

## Ratings, shared lists, popular here, party chat, speed memory, your subtitles, faster loads

- **Your ratings (1-10):** a "★ Rate it" menu on title pages and in the poster ＋ menu; "you 8/10" on posters; "My rating" sort on My list; a "your ratings" section in Stats (average, spread, genres you rate highest); Picked for you leans on shows you rated 8+ and never on ones rated 4 or less. Stored in bits 7-10 of the library status number, so it syncs with no database change.
- **Shared lists** (`functions/_lib/share.js`): Account → "share your list": Off / Whole list / Favourites only. `/u/<name>` shows titles, statuses, favourites and the owner's ratings (never progress or history), noindex. Stored in two spare bits of `users.prefs`; playback-pref syncing now leaves them alone.
- **Popular on animee / cinemee this week** (`functions/_lib/popular.js`, table `plays`, created on first use, kept 8 days): one anonymous count per show per day per browser when an episode starts (or after 90 s on the page for players that don't say). The home row appears once at least 6 shows qualify (2+ plays).
- **Party chat:** a chat line under the party bar (your username, or "Guest 1234"); one line a second per person; lines are passed on, never stored.
- **Kaze remembers speed and volume per show** (this browser), plus a speed button (0.75×–2×) while Kaze plays.
- **Your own subtitles on cinemee** (`functions/_lib/subs.js`, table `subs`, kept 3 days): "CC Your subtitles" takes an .srt/.vtt (500 KB max), converts it to WebVTT in the browser, uploads it, and plays the title on Atlas with `sub_url[]`/`sub_label[]` (EmbedMaster's documented parameters; the file is served with `Access-Control-Allow-Origin: *` as they require).
- **Faster loads:** scripts and styles now carry ETags and answer 304 when unchanged (before, `no-cache` with no validator meant a full download on every page load); the app's modules are preloaded. **Accessibility:** the player's messages are announced, the phone menu reports open/closed, the search box says when suggestions are showing.

## Watch party, better search, weekly digest, device switch, offline lists

- **Watch party** (`functions/_lib/party.js`, Durable Object `PartyRoom`, binding `PARTY`): 👥 Watch party on the watch page starts a room and copies an invite (`/watch/<id>?ep=N&party=CODE`). The host's show, episode, position and play/pause go out every 3 seconds; guests follow: episode changes, jumps on servers that take seek commands (3ellwa, Orion, Atlas, Kaze), pause/play on Kaze; otherwise the bar says where the host is. Reactions (😂 😮 ❤️ 🔥 😭 👏) float over the player. Rooms hold only the host key and last state, max 20 people, forgotten 12 hours after going quiet.
- **Search:** fixed animee's typo matching (two regexes had lost their backslashes, so it split queries on the letter "s" and never ignored punctuation). cinemee now finds misspelled titles too ("intersteller" → Interstellar, `functions/_lib/fuzzy.js`). Suggestions: "Did you mean…" when guessing, the alternate title that matched, recent searches when the box is empty, faster (300 ms).
- **Weekly digest:** Settings → Pop-ups → "Weekly summary (Sundays)": new episodes are collected and sent as one pop-up on Sunday 17:00 UTC (`alerts` bit 4).
- **Other device:** the "you're at … on another device" prompt now has Stay here, uses season names on cinemee, and also checks every 45 seconds while the player is idle (both devices open at once).
- **Offline:** the service worker keeps the page shell and scripts from the last visit (network first, so deploys still show at once); with no connection the app opens and My list, History and Stats work. The home page says so when offline.

## Seasons, admin insight, both sites together, hover previews, shared moments

- **Seasons on cinemee:** TV title pages list the seasons (poster, year, episode count), each opening its first episode; seasons that haven't started say when. The watch page's episode picker goes season by season (S1, S2 …) instead of by 100s.
- **/admin:** "servers tried last right now" (every current demotion, whole show or one episode, with a Clear button for false alarms) and "errors (7 days)": 5xx API answers per route and page crashes per view, per day (`functions/_lib/errors.js`, table `errors`, created on first use, kept 30 days; the browser sends at most three per page load, rate-limited, no personal data).
- **Both sites together:** signed in on both, the home page shows "Continue on cinemee" / "Continue on animee" (`GET /api/me/continue`, answered only to the sibling origin with credentials, `functions/_lib/crosssite.js`). Otherwise a small card about the other site (closable for 60 days). Also a footer link, and "Search … on cinemee/animee" when a search finds nothing.
- **Lighter home page:** genres come with `/api/home`; "Picked for you" is one `/api/picks?ids=` request instead of three; "episode N is out" checks are one `/api/next-out?items=` request instead of one per show.
- **Trailer on hover:** hold the mouse on a poster (wide screens) for a preview card: muted trailer (or art), genres, story, Watch / Details.
- **Share moment** on the watch page: copies `/watch/<id>?ep=N&t=seconds`; opening it starts there once.

## Servers that sort themselves, TV air times, scores, history, site notice

- **Servers that sort themselves** (`functions/_lib/ranking.js`): 2+ "didn't play" reports for one episode in 3 days, or failures on 3+ episodes of a show within 2 days, mark that server `struggling` there. Buttons keep their order (with a small ! and a tooltip); the first automatic pick, the fallback and auto-switching try struggling servers last. Read from the reports table by show, kept 10 minutes.
- **Real TV air times on cinemee** (`providers/tvmaze.js`, TVmaze, no key): the next episode's exact time on title pages ("in 2d 3h"), times on the schedule (sorted by time), and an episode that airs later today no longer counts as out (fixes early "new episode" alerts and unplayable newest episodes). The airing calendar now works on cinemee: one event for each show's next episode. Footer credits TVmaze.
- **Scores on cinemee** (`providers/omdb.js`): IMDb, Rotten Tomatoes and Metacritic at the top of the info box when the `OMDB_KEY` secret is set; the IMDb link always.
- **History** (My list → History): grouped by day, search, remove one item or clear all, each with Undo.
- **Site notice**: set on /admin (text, info or warning, optional link, optional hours); shown as a banner on every page of that site until it expires or the visitor closes it. `GET /api/notice`.
- API_VERSION 8.

## cinemee, and ideas from hianime

- **cinemee** (cinemee.animee.space): the same site for movies and TV, in red, from TMDB, with its own accounts and database, `/movie/…` and `/tv/…` addresses and search pages. Plays through one server, Nova.
- **Watch page:** glowing Next button (lime on animee, red on cinemee); "Not working? Try another server"; Auto skip intro switch on the bar; if no sub server plays, the dub with a note; ← → jump 10 seconds; resume where you stopped on 3ellwa with Start over; rewinding into a skipped intro pauses auto skip; Up next stays in fullscreen (MegaPlay's fullscreen handshake; phones keep their own); an Exit button in fullscreen that fades; phones turn sideways in our fullscreen; a break reminder after about 2 hours.
- **Lists:** save any show from its poster (＋ menu); Select mode on My list; Undo after Not interested; Hide genres (Settings); sub/dub counts on My list cards; "Remind me when it starts" for upcoming shows.
- **Pages:** "Newest: episode N" and "From episode 1" on show pages; MyAnimeList / AniList (or TMDB) links; title count, type chips and folding filters on Browse; Top 10 when one genre is picked; a bell on every schedule row; Picked for you on home; "A new episode should be out about now"; a What's new bar.
- **Privacy:** delete your account (password asked again); clear history and every watched tick.
- Broken artwork shows a quiet placeholder. Notification help mentions private windows.

## Short server names

- Server buttons use short neutral names instead of the upstream sites: **3ellwa** (MegaPlay), **Kaze** (AnimeParadise), **JoJo** (VidNest), **Hoshi** (TryEmbed). Internal ids are unchanged, so saved preferences, reports and the admin page keep working.
- When nothing plays, visitors see a plain "No server could play this episode" message; the per-server reasons (which name the upstream sites) go to the Worker logs. A single chosen server that fails says "<name> couldn't play this episode."

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

