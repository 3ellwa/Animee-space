import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRequest } from '../functions/_lib/requests.js';
import { validEndpoint, vapidHeader, resetSigningKey } from '../functions/_lib/push.js';

const who = 'abcdefghijklmnopqrstuv';

test('requests need a known kind, an anime name for "add", and a sensible message', () => {
  assert.deepEqual(cleanRequest({ who, kind: 'anime', anime: ' Frieren ', message: '' }),
    { who, kind: 0, anime: 'Frieren', message: '(no message)' });
  assert.throws(() => cleanRequest({ who, kind: 'anime', anime: '', message: 'pls' }), /Which anime/);
  assert.throws(() => cleanRequest({ who, kind: 'idea', message: 'hi' }), /at least 5/);
  assert.throws(() => cleanRequest({ who, kind: 'spam', message: 'hello there' }), /Pick what/);
  assert.throws(() => cleanRequest({ who: 'short', kind: 'idea', message: 'hello there' }), /Invalid request id/);
  assert.throws(() => cleanRequest({ who, kind: 'other', message: 'x'.repeat(1001) }), /1,000/);
});

test('pop-ups only go to real browser push services', () => {
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc123'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'));
  assert.ok(validEndpoint('https://web.push.apple.com/QWERTY'));
  assert.ok(validEndpoint('https://db5p.notify.windows.com/w/?token=1'));
  assert.equal(validEndpoint('https://evil.example/fcm.googleapis.com'), null);
  assert.equal(validEndpoint('http://fcm.googleapis.com/fcm/send/abc'), null);
  assert.equal(validEndpoint('not a url'), null);
});

test('the VAPID header is an ES256 token the public key verifies', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const env = { VAPID_PUBLIC_KEY: Buffer.from(raw).toString('base64url'), VAPID_PRIVATE_KEY: jwk.d };
  resetSigningKey();
  const header = await vapidHeader(env, 'https://fcm.googleapis.com/fcm/send/abc');
  const [, token, key] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, env.VAPID_PUBLIC_KEY);
  const [h, p, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url').toString()).alg, 'ES256');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
    Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok);
  resetSigningKey();
});
