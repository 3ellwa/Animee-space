# Animee catalogue and playback providers

## Tenrai catalogue

Animee uses the Tenrai v1 REST API at `https://api.tenrai.org/v1`. Tenrai follows the Jikan v4 response schema and provides catalogue search, anime details, and paginated episode records.

Strict safe-for-work filtering is enabled using `sfw-strict=true` on catalogue requests. Mature-rated or Ecchi/Hentai/Erotica details are rejected server-side as well. Playback adapters use the same SFW Tenrai details to identify a title before matching it against provider catalogues. The Worker Cache API and short in-memory caches reduce duplicate upstream calls.

## Built-in playback providers

### MegaPlay

MegaPlay uses `https://megaplay.buzz/stream/mal/{mal-id}/{episode-number}/{sub|dub}`. Animee checks the actual episode page because MegaPlay can return HTTP 200 for its unavailable-episode page. Playback is hosted in the provider iframe, so provider-owned controls remain inside the iframe.

### AnimeParadise

AnimeParadise is an independent sub-only provider. The adapter searches `https://api.animeparadise.moe`, fetches the title's episode list, then resolves its episode through the provider's `/ep/:uid` endpoint. It uses the provider's HLS endpoint at `https://stream.animeparadise.moe`.

The stream is delivered through `/api/stream-proxy`, which only accepts HTTPS requests to the AnimeParadise stream host and rewrites HLS playlist and key references back through that same restricted route. It does not proxy arbitrary URLs. Signed stream links may be short-lived or request-context dependent, so playback source responses and resolved AnimeParadise tokens are deliberately not cached across requests.

### Providers intentionally not duplicated

Anikoto is not listed as an independent playback provider because its current SDK adapter resolves the video through MegaPlay. Listing both would make one underlying source look like two independent fallbacks.

## Automatic sequential fallback

The watch page requests `server=auto`. The Worker tries the preferred provider first, then the remaining providers one at a time. It stops at the first provider that returns a usable embed or video source. If a provider fails to match the title, does not have the requested episode, or fails to resolve a source, the next provider is tried.

Each provider attempt has an 8-second deadline (later providers get what is left of a 12-second budget, never less than 3 seconds). A provider that fails 3 times in a row with a timeout or server error is skipped for 5 minutes in that isolate; an answer that it simply lacks the episode does not count. Timeouts are returned as HTTP 504 naming the provider.

Successful fallback results are cached in the Worker isolate for two minutes; failures are cached for 15 seconds. The API response also uses the Cloudflare Cache API. Isolate memory is temporary and is not shared globally, so cache hits are an optimization rather than persistent storage.

The provider list describes adapters that Animee knows how to call, not guaranteed availability for every title or episode. Animee does not claim that every provider has a complete catalogue. Upstream sites can change their domains, markup, APIs, or availability without notice.

The browser player loads hls.js v1.7.4 (with its integrity hash) the first time an HLS source plays, so pages that never play HLS do not download it. The Worker CSP permits the pinned jsDelivr script and the HTTPS media/frame origins required by independent providers.

## Custom embed providers

Additional authorized HTTPS embed providers can be configured with the Worker variable `ANIMEE_EMBED_PROVIDERS`, a JSON array of objects containing a unique `id`, `name`, `embedUrlTemplate`, and `categories` (`sub`, `dub`, or both). Supported placeholders are `{malId}`, `{episode}`, and `{category}`. Only configure URL patterns you are authorized to use and have verified.

No Anivexa instance, `ANIVEXA_API_URL`, separate Node service, or additional paid backend is required by the built-in integrations.
