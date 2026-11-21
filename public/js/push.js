// New-episode pop-ups on this device (see functions/_lib/push.js for the server side).
// Turning them on registers this browser's push address with the list of followed shows;
// following or unfollowing later updates that list.

import * as store from './store.js';
import { BRAND } from './site.js';

const ON_KEY = 'animee-space:push-on';
const alertsCode = () => ({ both: 0, sub: 1, dub: 2 }[store.getSettings().alertsFor] ?? 0);

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
// iPhone and iPad only allow pop-ups for the installed app (Add to Home Screen).
export const needsInstall = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(matchMedia('(display-mode: standalone)').matches || navigator.standalone);

let keyCache;
export async function serverKey() {
  if (keyCache !== undefined) return keyCache;
  try { keyCache = (await (await fetch('/api/push/key')).json()).publicKey || null; } catch { keyCache = null; }
  return keyCache;
}

async function subscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
export async function isOn() {
  try { return !!(await subscription()) && localStorage.getItem(ON_KEY) === '1'; } catch { return false; }
}

const toBytes = (b64) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
async function post(path, body) {
  const r = await fetch('/api/push/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
  return d;
}

export async function enable() {
  if (!supported()) throw new Error('This browser can’t show pop-ups.');
  if (needsInstall()) throw new Error(`On iPhone and iPad, add ${BRAND.name} to your Home Screen first (Share → Add to Home Screen), then turn pop-ups on from the installed app.`);
  const key = await serverKey();
  if (!key) throw new Error('Pop-ups aren’t set up on the server yet.');
  const answer = await Notification.requestPermission();
  if (answer !== 'granted') throw new Error(`Notifications are blocked for ${BRAND.name}. Allow them in your browser’s site settings (the icon left of the address), then try again.`);
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
    } catch (err) {
      // "Registration failed - push service error": the browser's own push service said no.
      // Brave turns Google's push service off by default; other browsers hit this when a
      // network or extension blocks it.
      const brave = await navigator.brave?.isBrave?.().catch(() => false);
      if (brave) throw new Error('Brave blocks pop-ups by default. Open brave://settings/privacy, turn on "Use Google services for push messaging", restart Brave, then press Turn on again.');
      if (err?.name === 'AbortError' || /push service/i.test(err?.message || '')) {
        throw new Error('Your browser\'s push service refused to sign up this device. A network, VPN or ad blocker may be blocking it; try again without them, or in Chrome, Edge or Firefox.');
      }
      throw err;
    }
  }
  await post('subscribe', { endpoint: sub.endpoint, ids: store.followedIds(), alerts: alertsCode() });
  try { localStorage.setItem(ON_KEY, '1'); } catch { /* ignore */ }
}

export async function disable() {
  const sub = await subscription().catch(() => null);
  if (sub) {
    await post('unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  try { localStorage.removeItem(ON_KEY); } catch { /* ignore */ }
}

export async function test() {
  const sub = await subscription();
  if (!sub) throw new Error('Pop-ups are off on this device.');
  return post('test', { endpoint: sub.endpoint });
}

// Keep the server's list of followed shows in step with this device.
let timer = null;
export function syncFollows() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!(await isOn())) return;
    const sub = await subscription().catch(() => null);
    if (sub) post('subscribe', { endpoint: sub.endpoint, ids: store.followedIds(), alerts: alertsCode() }).catch(() => {});
  }, 1500);
}
store.onFollowChange(syncFollows);
