// Service worker for the installed app. It never caches pages or data, so a deploy shows up
// straight away; it only answers with a small offline page when the network is down.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · animee space</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090A;color:#F2F3EE;font:16px system-ui,sans-serif;text-align:center}
b{display:block;font-size:72px;color:#C6FF3D;text-shadow:0 0 28px rgba(198,255,61,.55);margin-bottom:12px}p{color:#8D939C}
button{margin-top:16px;padding:11px 20px;border-radius:999px;border:0;background:#C6FF3D;color:#08090A;font-weight:700;cursor:pointer;box-shadow:0 0 30px rgba(198,255,61,.45)}</style></head>
<body><main><b>-.-zz</b><h1>you're offline.</h1><p>Connect to the internet to keep watching.</p><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() =>
    new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
