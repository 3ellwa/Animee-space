# animee

Watch anime. Stay happy. ^^.

## Personality

Happy, quick, a little cheeky. animee is the friend who already queued the next episode. The UI stays night-dark and lets one colour, Lime, do the talking. It glows, it never shouts.

Voice: short, lowercase-friendly, kaomoji where a person would use them, never corporate.

- Section headings end with a lime full stop: "fresh picks.", "top 10 this season."
- Loading: the ^^. face blinks while the dot hops.
- Empty: `( ._. )` · Error: `(x_x)` · 404: `-_-.` · Offline: `-.-zz`
- Idle for a minute (not on the watch page): the page dims and asks "still there? ^^."

## Logo

The mark is the end of the name: the "ee" in animee become two happy closed eyes, `^^`, and the full stop makes the face. The wordmark is `anim^^.` with the eyes and dot in Lime.

- `public/favicon.svg` is the app mark: ink `^^.` on a Lime rounded square.
- `scripts/make-icons.mjs` draws the PNG app icons from the same geometry. Run it after changing the mark.
- In the page, the glyph is inline SVG (`.eye` paths and a `.dot` circle) so the eyes can blink.

Keep a clear gap between the two chevrons and before the dot. If they touch, the mark reads as "M.".

## Colours

| Name | Hex | Use |
|---|---|---|
| Ink | #08090A | Page background |
| Graphite | #121417 | Cards |
| Slate | #1A1D22 | Raised, hover |
| Line | #23272D | Borders |
| Paper | #F2F3EE | Primary text |
| Fog | #8D939C | Secondary text |
| Lime | #C6FF3D | The brand: buttons, active states, glow |
| Zest | #E6FF9A | Lime highlight, hover |
| Moss | #7DBA00 | Lime shadow |
| Sakura | #FF8FB8 | Favourites only |

Text on Lime is always Ink. Lime glows (`--glow-sm`, `--glow`, `--glow-lg`) instead of using hard drop shadows.

## Type

- Headings and the wordmark: Bricolage Grotesque, 700 to 800, tight tracking.
- Everything else: Inter.
- Both are self-hosted in `public/fonts/` under the SIL Open Font License (`public/fonts/OFL.txt`). No font CDN.

## Motion

One easing curve, `cubic-bezier(.22, 1, .36, 1)`. Pages rise in, cards lift and glow under the cursor, the spotlight drifts and its active dot fills over 7 seconds, the scroll progress line glows at the top. Everything respects `prefers-reduced-motion`.
