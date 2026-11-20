// Service worker for the installed app. It never caches pages or data, so a deploy shows up
// straight away; it only answers with a small offline page when the network is down.
const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · animee space</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0b14;color:#ece8f6;font:16px system-ui,sans-serif;text-align:center}
button{margin-top:16px;padding:10px 18px;border-radius:999px;border:0;background:#ff7eb6;color:#160d1c;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>You're offline</h1><p>Connect to the internet to keep watching.</p><button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() =>
    new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
