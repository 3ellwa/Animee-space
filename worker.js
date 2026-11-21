import { onRequest } from "./functions/api/[[path]].js";
import { ASSETS } from "./worker-assets.js";
import * as seo from "./functions/_lib/seo.js";

const TYPES = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".txt":"text/plain; charset=utf-8",".png":"image/png",".webmanifest":"application/manifest+json",".woff2":"font/woff2",".xml":"application/xml; charset=utf-8"};
// Images and fonts are stored in worker-assets.js as { b64 } (see scripts/build-assets.mjs).
const decoded = new Map();
function bodyOf(key, value) { if (typeof value === "string") return value; if (!decoded.has(key)) decoded.set(key, Uint8Array.from(atob(value.b64), c => c.charCodeAt(0))); return decoded.get(key); }

// Inline style attributes are used by app.js templates, so style-src needs 'unsafe-inline'.
// Scripts: only this site, Cloudflare analytics, and the one pinned hls.js version (player.js loads it
// on demand and checks its hash). JSON-LD blocks are data, not scripts, so CSP doesn't apply to them.
// frame-src stays open to https: because ANIMEE_EMBED_PROVIDERS can add embed hosts without a code change.
const CSP = ["default-src 'self'","script-src 'self' https://static.cloudflareinsights.com https://cdn.jsdelivr.net/npm/hls.js@1.7.4/","style-src 'self' 'unsafe-inline'","img-src 'self' data: https:","connect-src 'self' https: https://cloudflareinsights.com","media-src 'self' blob: https:","worker-src 'self' blob:","frame-src https://megaplay.buzz https://www.youtube-nocookie.com https:","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join("; ");
const SECURITY = {"X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":CSP,"X-Frame-Options":"DENY","Strict-Transport-Security":"max-age=31536000","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()"};

function cacheControl(key) {
  if (key === "/index.html" || key.endsWith(".js") || key.endsWith(".css")) return "no-cache";
  if (key.endsWith(".woff2")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}
function file(key) {
  if (ASSETS[key] === undefined) return null;
  const ext = key.slice(key.lastIndexOf("."));
  return new Response(bodyOf(key, ASSETS[key]), { headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": cacheControl(key), ...SECURITY } });
}
// Rendered pages are cached under a key that includes a hash of index.html, so each deploy
// that changes the page shell starts a fresh cache instead of serving last hour's HTML.
const SHELL_VERSION = (() => { let h = 0; for (const c of ASSETS["/index.html"]) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); })();
const html = (body, status, extra = {}) => new Response(body, { status, headers: { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache", ...SECURITY, ...extra } });

// App pages: index.html with this page's title, description, canonical, previews and JSON-LD.
// Rendered pages are kept in the edge cache for an hour (the catalogue changes slowly).
async function page(request, url, ctx) {
  const cache = globalThis.caches?.default;
  const key = new Request(url.origin + url.pathname + url.search + (url.search ? "&" : "?") + "__page=" + SHELL_VERSION, { method: "GET" });
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return new Response(hit.body, hit);
  }
  const shell = ASSETS["/index.html"];
  const info = await seo.describe(url).catch(() => ({ status: 200, transient: true }));
  if (info?.redirect) return Response.redirect(info.redirect, 301);
  if (!info || info.status === 404) {
    // Unknown address: the app shows its 404 page, crawlers get a real 404 status.
    return html(seo.render(shell, { status: 404, title: "Page not found · animee" }), 404, { "X-Robots-Tag": "noindex" });
  }
  const response = html(seo.render(shell, info), 200);
  if (cache && !info.transient) {
    const stored = new Response(response.clone().body, response);
    stored.headers.set("Cache-Control", "public, max-age=3600");
    ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  }
  return response;
}

async function sitemap(url, ctx) {
  const cache = globalThis.caches?.default;
  const key = new Request(url.origin + "/sitemap.xml?__v=1", { method: "GET" });
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return new Response(hit.body, hit);
  const response = new Response(await seo.sitemap(), { headers: { "Content-Type": TYPES[".xml"], "Cache-Control": "public, max-age=21600" } });
  if (cache) ctx.waitUntil(cache.put(key, response.clone()).catch(() => {}));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // One address per page: plain http goes to https (search engines had indexed the http copy).
    // Local development (localhost) stays on http.
    if (url.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$/.test(url.hostname)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice(4).split("/").filter(Boolean);
      const response = await onRequest({ request, env, params: { path }, waitUntil: p => ctx.waitUntil(p) });
      const out = new Response(response.body, response);
      out.headers.set("X-Robots-Tag", "noindex");
      return out;
    }
    const respond = (res) => (request.method === "HEAD" ? new Response(null, res) : res);
    if (url.pathname === "/robots.txt") return respond(new Response(seo.robots(), { headers: { "Content-Type": TYPES[".txt"], "Cache-Control": "public, max-age=3600" } }));
    if (url.pathname === "/sitemap.xml") return respond(await sitemap(url, ctx));
    // Browsers and crawlers ask for /favicon.ico on their own; answer with the PNG mark.
    if (url.pathname === "/favicon.ico") return respond(file("/icons/icon-192.png"));
    const key = url.pathname === "/" ? "/index.html" : url.pathname;
    if (key !== "/index.html" && key in ASSETS) return respond(file(key));
    if (/\.[a-z0-9]+$/i.test(key) && key !== "/index.html") return new Response("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex" } });
    return respond(await page(request, url, ctx));
  },
};
