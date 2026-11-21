import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanReport } from '../functions/_lib/reports.js';
import { handleAccount } from '../functions/_lib/account.js';

const ids = ['megaplay', 'animeparadise'];

test('reports keep only known shows, episodes, servers and reasons', () => {
  assert.deepEqual(cleanReport({ a: '21', ep: 9, p: 'megaplay', c: 'dub', r: 'video' }, ids),
    { anime: 21, ep: 9, provider: 'megaplay', cat: 1, reason: 1 });
  assert.equal(cleanReport({ a: '21', ep: 9, p: 'evil.example', c: 'sub', r: 'video' }, ids), null);
  assert.equal(cleanReport({ a: '21', ep: 0, p: 'megaplay', r: 'video' }, ids), null);
  assert.equal(cleanReport({ a: 'x', ep: 1, p: 'megaplay', r: 'video' }, ids), null);
  assert.equal(cleanReport({ a: '21', ep: 1, p: 'megaplay', r: 'spam' }, ids), null);
});

test('sign-in answers 429 once the rate limit is used up', async () => {
  const env = { DB: {}, LOGIN_LIMITER: { limit: async () => ({ success: false }) } };
  const request = new Request('https://animee.space/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'someone', password: 'whatever123' }),
  });
  const res = await handleAccount({ request, env }, ['auth', 'login']);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '60');
});
