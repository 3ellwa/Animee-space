import { handleParty } from "./functions/_lib/party.js";
import { onRequest } from "./functions/api/[[path]].js";
import { ASSETS } from "./worker-assets.js";
import * as seo from "./functions/_lib/seo.js";
import { runPushCheck } from "./functions/_lib/push.js";
import { handleMy } from "./functions/_lib/myspace.js";
import { SITES, siteOf, siteEnv, brandShell, brandServiceWorker } from "./functions/_lib/site.js";

const TYPES = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".txt":"text/plain; charset=utf-8",".png":"image/png",".webmanifest":"application/manifest+json",".woff2":"font/woff2",".xml":"application/xml; charset=utf-8"};
// Images and fonts are stored in worker-assets.js as { b64 } (see scripts/build-assets.mjs).
const decoded = new Map();
function bodyOf(key, value) { if (typeof value === "string") return value; if (!decoded.has(key)) decoded.set(key, Uint8Array.from(atob(value.b64), c => c.charCodeAt(0))); return decoded.get(key); }

// Inline style attributes are used by app.js templates, so style-src needs 'unsafe-inline'.
// Scripts: only this site, Cloudflare analytics, and the one pinned hls.js version (player.js loads it
// on demand and checks its hash). JSON-LD blocks are data, not scripts, so CSP doesn't apply to them.
// frame-src stays open to https: because ANIMEE_EMBED_PROVIDERS can add embed hosts without a code change.
const CSP = ["default-src 'self'","script-src 'self' https://static.cloudflareinsights.com https://cdn.jsdelivr.net/npm/hls.js@1.7.4/","style-src 'self' 'unsafe-inline'","img-src 'self' data: https:","connect-src 'self' https: https://cloudflareinsights.com http://localhost:8787 http://cinemee.localhost:8787 http://mangee.localhost:8787 wss: ws://localhost:8787 ws://cinemee.localhost:8787 ws://mangee.localhost:8787","media-src 'self' blob: https:","worker-src 'self' blob:","frame-src https://megaplay.buzz https://www.youtube-nocookie.com https:","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join("; ");
const SECURITY = {"X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":CSP,"X-Frame-Options":"DENY","Strict-Transport-Security":"max-age=31536000","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()"};

function cacheControl(key) {
  if (key === "/index.html" || key.endsWith(".js") || key.endsWith(".css")) return "no-cache";
  if (key.endsWith(".woff2")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}
// cinemee's own icons, manifest and share image live in public/sites/cinemee/ and win over the
// shared files at the same path.
// A short content hash per file, so "no-cache" files are revalidated with a 304 instead of
// downloaded again on every page load.
const ETAGS = new Map();
function etagOf(key) {
  if (!ETAGS.has(key)) {
    const text = String(ASSETS[key]);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    ETAGS.set(key, `"${(h >>> 0).toString(36)}-${text.length.toString(36)}"`);
  }
  return ETAGS.get(key);
}
function file(key, site = "animee", request = null) {
  const own = site !== "animee" && ASSETS["/sites/" + site + key] !== undefined ? "/sites/" + site + key : null;
  if (own) key = own;
  if (ASSETS[key] === undefined) return null;
  const ext = key.slice(key.lastIndexOf("."));
  const etag = etagOf(key);
  const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheControl(key), ETag: etag, ...SECURITY };
  const seen = request?.headers.get("If-None-Match") || "";
  if (seen && seen.split(/\s*,\s*/).some((t) => t.replace(/^W\//, "") === etag)) return new Response(null, { status: 304, headers });
  return new Response(bodyOf(key, ASSETS[key]), { headers });
}
// Rendered pages are cached under a key that includes a hash of index.html, so each deploy
// that changes the page shell starts a fresh cache instead of serving last hour's HTML.
const SHELL_VERSION = (() => { let h = 0; for (const c of ASSETS["/index.html"]) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();
const html = (body, status, extra = {}) => new Response(body, { status, headers: { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache", ...SECURITY, ...extra } });

// App pages: index.html with this page's title, description, canonical, previews and JSON-LD.
// Rendered pages are kept in the edge cache for an hour (the catalogue changes slowly).
async function page(request, url, ctx, site = "animee", env = {}) {
  const cache = globalThis.caches?.default;
  // The site is part of the key, so a page cached for one site is never served on the other.
  const key = new Request(url.origin + url.pathname + url.search + (url.search ? "&" : "?") + "__page=" + SHELL_VERSION + "-" + site, { method: "GET" });
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      // The edge keeps its copy for an hour; browsers must check back every time.
      const fresh = new Response(hit.body, hit);
      fresh.headers.set("Cache-Control", "no-cache");
      return fresh;
    }
  }
  const shell = brandShell(ASSETS["/index.html"], site);
  const info = await seo.describe(url, site, env).catch(() => ({ status: 200, transient: true }));
  if (info?.redirect) return Response.redirect(info.redirect, 301);
  if (!info || info.status === 404) {
    // Unknown address: the app shows its 404 page, crawlers get a real 404 status.
    return html(seo.render(shell, { status: 404, title: `Page not found · ${SITES[site].name}` }, site), 404, { "X-Robots-Tag": "noindex" });
  }
  const response = html(seo.render(shell, info, site), 200);
  if (cache && !info.transient) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set("Cache-Control", "public, max-age=3600");
    ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  }
  return response;
}

async function sitemap(url, ctx, env = {}) {
  const cache = globalThis.caches?.default;
  const key = new Request(url.origin + "/sitemap.xml?__v=1", { method: "GET" });
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return new Response(hit.body, hit);
  const response = new Response(await seo.sitemap(siteOf(url.href), env), { headers: { "Content-Type": TYPES[".xml"], "Cache-Control": "public, max-age=21600" } });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return response;
}

export { PartyRoom } from "./functions/_lib/party.js";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // One address per page: plain http goes to https (search engines had indexed the http copy).
    // Local development (localhost) stays on http.
    if (url.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    // my.animee.space: the desktop app's download page (functions/_lib/myspace.js).
    if (/^my\./.test(url.hostname)) {
      return (await handleMy(request, url, ctx, file)) || new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
    }
    // animee or cinemee, by address; cinemee gets its own database (see functions/_lib/site.js).
    const site = siteOf(request.url);
    const siteEnvironment = siteEnv(env, site);
    // Watch party rooms (WebSocket): answered directly, the upgrade can't be re-wrapped.
    const partyPath = url.pathname.match(/^\/api\/party\/([A-Z0-9]{6})\/ws$/);
    if (partyPath) return handleParty(request, siteEnvironment, partyPath[1], site);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice(4).split("/").filter(Boolean);
      const response = await onRequest({ request, env: siteEnvironment, params: { path }, waitUntil: p => ctx.waitUntil(p) });
      const out = new Response(response.body, response);
      out.headers.set("X-Robots-Tag", "noindex");
      return out;
    }
    const respond = (res) => (request.method === "HEAD" ? new Response(null, res) : res);
    if (url.pathname === "/robots.txt") return respond(new Response(seo.robots(site), { headers: { "Content-Type": TYPES[".txt"], "Cache-Control": "public, max-age=3600" } }));
    if (url.pathname === "/sitemap.xml") return respond(await sitemap(url, ctx, siteEnvironment));
    // Browsers and crawlers ask for /favicon.ico on their own; answer with the PNG mark.
    if (url.pathname === "/favicon.ico") return respond(file("/icons/icon-192.png", site));
    const key = url.pathname === "/" ? "/index.html" : url.pathname;
    // The per-site folders are only reachable through their normal paths.
    if (key.startsWith("/sites/")) return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
    if (key === "/sw.js" && site !== "animee") return respond(new Response(brandServiceWorker(ASSETS["/sw.js"], site), { headers: { "Content-Type": TYPES[".js"], "Cache-Control": "no-cache", ...SECURITY } }));
    if (key !== "/index.html" && key in ASSETS) return respond(file(key, site, request));
    if (/\.[a-z0-9]+$/i.test(key) && key !== "/index.html") return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
    return respond(await page(request, url, ctx, site, siteEnvironment));
  },
  // Every 10 minutes (wrangler.toml [triggers]): look for new episodes of followed shows and
  // wake the devices that asked for pop-ups.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPushCheck(siteEnv(env, "animee")).catch((err) => console.error("push check failed", err)));
    if (env.CINEMEE_DB) ctx.waitUntil(runPushCheck(siteEnv(env, "cinemee")).catch((err) => console.error("cinemee push check failed", err)));
    if (env.MANGEE_DB) ctx.waitUntil(runPushCheck(siteEnv(env, "mangee")).catch((err) => console.error("mangee push check failed", err)));
  },
};
