import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanNotice, currentNotice, setNotice, resetNoticeCache } from '../functions/_lib/notice.js';

test('notices are cleaned: empty clears, links must be local or https, hours become an end time', () => {
  assert.equal(cleanNotice({ text: '   ' }), null);
  const n = cleanNotice({ text: ' Server  3ellwa is down ', level: 'warn', link: '/requests', hours: 2 });
  assert.equal(n.text, 'Server 3ellwa is down');
  assert.equal(n.level, 'warn');
  assert.ok(n.until > Date.now() / 1000 + 7000 && n.until < Date.now() / 1000 + 7300);
  assert.equal(cleanNotice({ text: 'x', level: 'shout' }).level, 'info');
  assert.throws(() => cleanNotice({ text: 'x', link: 'javascript:alert(1)' }), (e) => e.status === 400);
  assert.throws(() => cleanNotice({ text: 'x', link: '//evil.example' }), (e) => e.status === 400);
  assert.throws(() => cleanNotice({ text: 'x'.repeat(281) }), (e) => e.status === 400);
});

function fakeDb() {
  let row = null;
  return {
    prepare(sql) {
      const stmt = { args: [], bind(...a) { stmt.args = a; return stmt; } };
      stmt.run = async () => {
        if (/^INSERT/.test(sql)) { const [text, level, link, created, until] = stmt.args; row = { text, level, link, created, until }; }
        if (/^DELETE/.test(sql)) row = null;
      };
      stmt.first = async () => row;
      return stmt;
    },
  };
}

test('a notice is saved per site, expires, and clearing removes it', async () => {
  resetNoticeCache();
  const env = { DB: fakeDb(), SITE: 'cinemee' };
  assert.equal(await currentNotice(env), null);
  const saved = await setNotice(env, { text: 'Maintenance tonight', link: 'https://example.com/status' });
  assert.equal(saved.text, 'Maintenance tonight');
  assert.equal((await currentNotice(env)).link, 'https://example.com/status');
  assert.equal(await setNotice(env, { text: '' }), null);
  resetNoticeCache();
  const old = { DB: { prepare: () => ({ first: async () => ({ text: 'old', level: 'info', created: 1, until: 2 }) }) } };
  assert.equal(await currentNotice(old), null, 'expired notices are not shown');
});
