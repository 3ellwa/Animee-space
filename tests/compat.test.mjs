import assert from 'node:assert/strict';
import { test } from 'node:test';

test('older TV browsers get randomUUID, AbortSignal.timeout, Array#at and Object.hasOwn', async () => {
  const saved = { uuid: crypto.randomUUID, timeout: AbortSignal.timeout, at: Array.prototype.at, hasOwn: Object.hasOwn };
  try {
    // Pretend to be Chrome 87.
    crypto.randomUUID = undefined;
    AbortSignal.timeout = undefined;
    delete Array.prototype.at;
    Object.hasOwn = undefined;
    await import(`../public/js/compat.js?fresh=${Date.now()}`);
    assert.match(crypto.randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const signal = AbortSignal.timeout(10);
    assert.equal(signal.aborted, false);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(signal.aborted, true);
    assert.equal([1, 2, 3].at(-1), 3);
    assert.equal([1, 2, 3].at(5), undefined);
    assert.equal(Object.hasOwn({ a: 1 }, 'a'), true);
  } finally {
    crypto.randomUUID = saved.uuid;
    AbortSignal.timeout = saved.timeout;
    Object.defineProperty(Array.prototype, 'at', { value: saved.at, configurable: true, writable: true });
    Object.hasOwn = saved.hasOwn;
  }
});
