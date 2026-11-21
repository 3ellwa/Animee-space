import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStatus } from '../functions/_lib/account.js';

test('list status keeps 0-6, the favourite and audio flags, and drops anything else', () => {
  assert.equal(cleanStatus(3), 3);          // completed
  assert.equal(cleanStatus(6), 6);          // not interested
  assert.equal(cleanStatus(8), 8);          // favourite only
  assert.equal(cleanStatus(8 | 1), 9);      // favourite + watching
  assert.equal(cleanStatus(7), 0);          // unknown status
  assert.equal(cleanStatus(15), 8);         // unknown status, favourite kept
  assert.equal(cleanStatus(16 | 32 | 1), 49); // watching, dub chosen for this show
  assert.equal(cleanStatus(64 | 1), 65);     // watching + following
  assert.equal(cleanStatus(255), 120);      // clamped to 127: flags kept, unknown status dropped
  assert.equal(cleanStatus(-4), 0);
  assert.equal(cleanStatus('x'), 0);
});
