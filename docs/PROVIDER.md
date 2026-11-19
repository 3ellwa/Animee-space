# Animee catalogue and playback provider

## Tenrai catalogue

Animee uses the Tenrai v1 REST API at `https://api.tenrai.org/v1`. Tenrai follows the Jikan v4 response schema and provides catalogue search, anime details, and paginated episode records.

Strict safe-for-work filtering is enabled using `sfw-strict=true` on catalogue requests. Mature-rated or Ecchi/Hentai/Erotica details are rejected server-side as well. The provider is called server-side, not directly from browser JavaScript. Worker Cache API responses reduce duplicate upstream calls.

Primary endpoints:
- `GET /seasons/now?limit=24&sfw-strict=true`
- `GET /anime?q=Naruto&limit=24&page=1&sfw-strict=true`
- `GET /anime/{mal_id}/full?sfw-strict=true`
- `GET /anime/{mal_id}/episodes?page=1&limit=25&sfw-strict=true`

The public API documentation currently lists a limit of 120 requests per minute and 4 requests per second. Search uses one catalogue request per submitted query, with a short autocomplete delay and response caching.

## MegaPlay playback

For an anime's MAL ID and episode number, Animee builds:
- `https://megaplay.buzz/stream/mal/{mal-id}/{episode-number}/sub`
- `https://megaplay.buzz/stream/mal/{mal-id}/{episode-number}/dub`

The player uses an iframe. The provider owns its playback controls; Animee cannot directly control seeking, quality, or subtitles across the cross-origin boundary. MegaPlay documents `time`, `complete`, `error`, and `watching-log` postMessage events, which Animee validates by origin and iframe source before saving progress.

MegaPlay warns that not every title is mapped through MAL or AniList IDs yet. A search result can therefore exist without a working embed.
