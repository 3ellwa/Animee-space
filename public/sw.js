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

// New-episode pop-ups. Pushes carry no payload: ask the server what's new, then show it.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) items = (await (await fetch('/api/push/pending?endpoint=' + encodeURIComponent(sub.endpoint))).json()).items || [];
    } catch { /* show the generic one below */ }
    if (!items.length) items = [{ title: 'New episodes are out', body: 'Open animee to see what’s new.', url: '/new' }];
    await Promise.all(items.slice(0, 3).map((it) => self.registration.showNotification(
      it.test ? it.title : `${it.title}`,
      {
        body: it.test || it.body ? it.body : `Episode ${it.ep} is out. Tap to watch.`,
        icon: it.cover || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: it.id ? `ep-${it.id}` : 'animee',
        data: { url: it.url || (it.id ? `/watch/${it.id}?ep=${it.ep}` : '/new') },
      },
    )));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((t) => t.url.startsWith(self.location.origin));
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
