# What we learned from hianime.ms (November 2026)

Read from hianime.ms's public pages and their page scripts (`main.js`, `watch.js`, `profile.js`),
which are well commented. They use the same players as animee (MegaPlay, VidNest, TryEmbed), so
their player tricks apply directly. Everything below is written in our own words and our own code;
nothing of theirs is copied into animee.

## Already done in animee

| What | How it works | Where |
|---|---|---|
| Up next in fullscreen | MegaPlay's player asks its page `getFullscreenState`. Answering `megaFullscreenState` makes its own fullscreen button send `toggleFullscreen` instead, so the page's whole player box goes fullscreen and stays so into the next episode. | `public/js/player.js` |
| Not on phones | Phones keep MegaPlay's own fullscreen: taking it over stops the rotate-to-landscape. | `tellFullscreen()` |
| Resume on MegaPlay | MegaPlay takes `{"event":"seek","time":N}` (as a JSON string). Once it reports playback, jump to 3 s before the saved time, and offer **Start over**. | `megaSend()`, `onResumed` |
| Intro/outro auto skip | `{"cmd":"SKP_DATA","auto":true}` turns on MegaPlay's own skip where it knows the times. Setting: *Skip intros and outros automatically*. | `player.js`, Settings |
| Error that recovers | MegaPlay sometimes reports an error and then plays anyway: only switch servers if no playback follows within 5 s. | `handleEmbedMessage()` |
| `startAt` | VidNest and TryEmbed take `?startAt=<seconds>`. | already in the merge |

## Worth adding next (most useful first)

1. **"Not working" button on the player.** One tap logs a report and moves to the next server in the same language. We have Report and automatic switching; this joins them into one obvious button.
2. **Reorder servers from reports.** Servers reported broken for an episode drop to the end of the list for that episode (a scheduled job reads the reports table). We already collect the reports.
3. **Arrow keys seek ±10 s** in MegaPlay (via the seek command) instead of doing nothing; they found people pressed → to skip intros. Our N / P episode keys stay.
4. **Offer to follow when the newest episode ends.** After watching the latest episode of an airing show: "Tell me when the next one is out" (one tap = our 🔔 Follow).
5. **Follow from the schedule**, plus a *Just my shows* filter on the schedule page.
6. **Select mode on My list** to remove many shows at once.
7. **Rewinding into a skipped intro** pauses auto skip for that episode, so the intro can be watched.
8. **Exit-fullscreen button** that fades after 3 s, and on phones our Fullscreen also turns the video sideways (`screen.orientation.lock('landscape')`).
9. **Break reminder** after about 2 hours of watching (only while a video is open and the tab is visible; a 30-minute pause resets it).
10. **Hide genres** setting: chosen genres are left out of rows, search and picks.
11. **Broken artwork fallbacks:** a missing backdrop falls back to the poster, then a placeholder.
12. **Share buttons that follow the episode being watched.**
13. **Site news in Notifications** (short announcements with a "read more").

## Seen but not for us

- Ads (device-specific ad slots, a sponsor gate before playing, a sticky ad bar).
- Light theme and accent colours (we chose dark only).
- Sign-in with a private key instead of accounts (we chose accounts).
- Their own `/stream/` proxy for a backup server (stripping or re-serving other sites' players).
