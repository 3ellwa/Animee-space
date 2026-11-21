# What we learned from hianime.ms (November 2026)

Read from hianime.ms's public pages and the page scripts their pages load (`main.js`, `watch.js`,
`profile.js`), which are well commented. They use the same players as animee (MegaPlay, VidNest,
TryEmbed), so their player tricks apply directly. Everything here is in our own words and our own
code; nothing of theirs is copied into animee.

**Scope note.** Their robots.txt blocks AI crawlers (including Anthropic's) and sets
`ai-train=no, use=reference`. So this was a reference look, not a crawl: the three scripts their
pages load, plus one page of each main type (home, show, watch, browse, schedule, My Anime)
viewed in a normal browser.

## Already done in animee

| What | How | Where |
|---|---|---|
| Up next in fullscreen | MegaPlay asks its page `getFullscreenState`; answering `megaFullscreenState` makes its own fullscreen button send `toggleFullscreen`, so the whole player box goes fullscreen and stays so into the next episode. | `public/js/player.js` |
| Phones keep their fullscreen | The handshake isn't answered on touch screens, so rotate-to-landscape keeps working. | `tellFullscreen()` |
| Resume on MegaPlay | It takes `{"event":"seek","time":N}` (JSON string) once playing; we jump to 3 s before the saved time and offer **Start over**. | `megaSend()`, `onResumed` |
| Intro/outro auto skip | `{"cmd":"SKP_DATA","auto":true}`; Settings switch. | `player.js` |
| MegaPlay error that recovers | Only switch servers if nothing plays within 5 s. | `handleEmbedMessage()` |
| `startAt` on VidNest/TryEmbed | `?startAt=<seconds>` | providers |
| Also already in animee | Remove from Continue watching, posters and your own time in the schedule, Install the app, Resume, Skip filler, typo-tolerant search, new-episode pop-ups, Help me pick, Requests, Wide player, Report, AniList/MAL import, share. | — |

## Worth adding (most useful first)

**Player**
1. **"Not working" button** beside the servers: one tap logs a report and moves to the next server in the same language. (They also offer a short "What went wrong with episode N?" panel.)
2. **Auto skip and Auto next as switches on the watch page itself**, not only in Settings.
3. **Reorder servers from reports:** servers reported broken for an episode go to the end of the list for that episode.
4. **Sub missing → dub, with a note** ("the subtitled copy is missing right now, so we switched you to the dub").
5. **Arrow keys seek ±10 s** in MegaPlay (their visitors pressed → to skip intros); our N/P keys stay for episodes.
6. **Rewinding into a skipped intro** pauses auto skip for that episode.
7. **"Start this show from the beginning"**: forgets the saved times of every episode of the show.
8. **"A new episode should be out about now"** when a countdown reaches zero.
9. **Exit-fullscreen button** that fades after 3 s; on phones our Fullscreen also turns the video sideways.
10. **Break reminder** after about 2 hours of watching (only with a video open and the tab visible).

**Lists and My Anime**
11. **Save from any poster:** a small button on every card opens Add to list / Favourite / Not interested.
12. **Select mode on My list** to remove many shows at once.
13. **Not interested tab with Undo** ("Hidden. Bring it back any time").
14. **Hide genres you skip:** chosen genres are left out of rows, search and picks.
15. **Sub/dub episode counts on My list cards.**
16. **Picked for you** on home (from your history; empty until you've watched a few).
17. **Clear all watch history and watched ticks**, and **delete your account** (privacy).
18. **"Remind me when it starts"** for shows that haven't aired yet (follow before the premiere).

**Show, browse and schedule pages**
19. **Show page buttons:** "Start with episode 1", **"Newest: episode N"** and "All episodes" side by side.
20. **Sub N / Dub N counts** on show pages and on every poster.
21. **Links out to MyAnimeList and AniList** on show pages.
22. **Browse:** a title count ("7,973 titles"), quick type chips (All, TV, Movies…) with the full filters behind a "Filters" button, and a **sub/dub language filter**.
23. **Schedule:** a 🔔 on every row to follow that show, and the episode number on each row.

**Site**
24. **"What's new" popup:** a dated list of new features, shown once per session with "Got it".
25. **Top 10 on genre pages.**
26. **Notification troubleshooting text** for private/incognito windows (Firefox, Chrome) and iPhone.
27. **Broken artwork fallbacks:** missing backdrop → poster → placeholder.

## Seen but not for us

- Ads: device-specific ad slots, a sponsor gate before playing, a sticky ad bar.
- Light theme and accent colours (we chose dark only).
- Private-key sign-in instead of accounts (we chose accounts).
- Their own `/stream/` backup server (re-serving other sites' players).
- "Make a TikTok about us" growth prompts.
