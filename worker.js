import { onRequest } from "./functions/api/[[path]].js";
import { ASSETS } from "./worker-assets.js";
const TYPES={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".txt":"text/plain; charset=utf-8",".png":"image/png",".webmanifest":"application/manifest+json",".woff2":"font/woff2"};
// Images and fonts are stored in worker-assets.js as { b64 } (see scripts/build-assets.mjs).
const decoded=new Map();
function bodyOf(key,value){if(typeof value==="string")return value;if(!decoded.has(key))decoded.set(key,Uint8Array.from(atob(value.b64),c=>c.charCodeAt(0)));return decoded.get(key);}
// Inline style attributes are used by app.js templates, so style-src needs 'unsafe-inline'.
// Scripts: only this site, Cloudflare analytics, and the one pinned hls.js version (player.js loads it
// on demand and checks its hash).
// frame-src stays open to https: because ANIMEE_EMBED_PROVIDERS can add embed hosts without a code change.
const CSP=["default-src 'self'","script-src 'self' https://static.cloudflareinsights.com https://cdn.jsdelivr.net/npm/hls.js@1.7.4/","style-src 'self' 'unsafe-inline'","img-src 'self' data: https:","connect-src 'self' https: https://cloudflareinsights.com","media-src 'self' blob: https:","worker-src 'self' blob:","frame-src https://megaplay.buzz https://www.youtube-nocookie.com https:","object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'"].join("; ");
const SECURITY={"X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":CSP,"X-Frame-Options":"DENY","Strict-Transport-Security":"max-age=31536000","Permissions-Policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()"};
function asset(path){let key=path==="/"?"/index.html":path;if(!(key in ASSETS)&&!key.includes("."))key="/index.html";if(ASSETS[key]===undefined)return null;const body=bodyOf(key,ASSETS[key]);const ext=key.slice(key.lastIndexOf("."));return new Response(body,{headers:{"Content-Type":TYPES[ext]||"application/octet-stream","Cache-Control":key==="/index.html"||key.endsWith(".js")||key.endsWith(".css")?"no-cache":key.endsWith(".woff2")?"public, max-age=31536000, immutable":"public, max-age=3600",...SECURITY}});}
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==="/api"||url.pathname.startsWith("/api/")){const path=url.pathname.slice(4).split("/").filter(Boolean);return onRequest({request,env,params:{path},waitUntil:p=>ctx.waitUntil(p)});}const res=asset(url.pathname);if(res)return request.method==="HEAD"?new Response(null,res):res;return new Response("Not found",{status:404});}};
