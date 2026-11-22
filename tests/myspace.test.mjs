import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRelease, handleMy } from '../functions/_lib/myspace.js';
import { siteOf } from '../functions/_lib/site.js';

test('my.animee.space finds the installer in the newest GitHub release', () => {
  const r = pickRelease({ tag_name: 'v1.2.0', published_at: '2026-11-22T10:00:00Z', assets: [
    { name: 'latest.yml', size: 300, browser_download_url: 'https://github.com/x/latest.yml' },
    { name: 'my-space-setup.exe', size: 122661805, browser_download_url: 'https://github.com/3ellwa/Animee-space/releases/download/v1.2.0/my-space-setup.exe' },
  ] });
  assert.deepEqual(r, { version: '1.2.0', size: 122661805, url: 'https://github.com/3ellwa/Animee-space/releases/download/v1.2.0/my-space-setup.exe', published: '2026-11-22T10:00:00Z' });
  assert.deepEqual(pickRelease({ tag_name: 'v0.1', assets: [] }), { version: null });
  assert.deepEqual(pickRelease(null), { version: null });
});

test('my.animee.space serves only its own page, never the sites\' private folders', async () => {
  const served = [];
  const file = (key, site) => { served.push([key, site]); return new Response('ok'); };
  const ask = (path) => handleMy(new Request('https://my.animee.space' + path), new URL('https://my.animee.space' + path), { waitUntil() {} }, file);
  assert.ok(await ask('/'));
  assert.ok(await ask('/my.css'));
  assert.equal(await ask('/sites/cinemee/og.png'), null);
  assert.equal(await ask('/js/app.js'), null);
  assert.deepEqual(served, [['/index.html', 'my'], ['/my.css', 'my']]);
  // The other hosts are untouched.
  assert.equal(siteOf('https://my.animee.space/'), 'animee');
});
