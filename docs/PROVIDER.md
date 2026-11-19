# Anikoto + MegaPlay integration

The active provider is `anikoto`, configured in `wrangler.toml`. It uses the documented public endpoints:

- `https://anikotoapi.site/recent-anime?page=1&per_page=20`
- `https://anikotoapi.site/series/{id}`
- `https://megaplay.buzz/stream/s-2/{episode_embed_id}/{language}`
- `https://megaplay.buzz/stream/mal/{mal_id}/{episode_number}/{language}`
- `https://megaplay.buzz/stream/ani/{anilist_id}/{episode_number}/{language}`

The Pages Function proxies the Anikoto catalog endpoints to avoid making browser clients depend directly on the catalog host. MegaPlay playback URLs are returned as iframe URLs, not as direct media sources, because direct embed-link access is disabled by the service.

## Catalog API proxy

- `GET /api/anikoto/recent-anime?page=1&per_page=20`
- `GET /api/anikoto/series/:id`
- `GET /api/anikoto/embed/:episode_embed_id/:language`

The series response is passed through unchanged so its original fields, including each `episode_embed_id`, remain available to the frontend.

## Player events

The MegaPlay iframe sends `postMessage` events. The player validates both `event.origin` (`https://megaplay.buzz`) and `event.source` (the active iframe) before using them. `time` and `watching-log` events update watch progress; `complete` marks an episode watched and runs auto-next; `error` displays a playback message.

## Playback limitations

The MegaPlay player owns its internal controls. The surrounding app cannot reliably control seeking, quality, subtitles, or intro skipping through the documented API. The app therefore disables its HLS quality selector while an embed is active and relies on MegaPlay's own controls. Resume position is stored from events, but the provided documentation does not define a seek command to restore that position inside the iframe.
