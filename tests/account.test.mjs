import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStatus } from '../functions/_lib/account.js';

test('list status keeps 0-6 and the favourite flag, and drops anything else', () => {
  assert.equal(cleanStatus(3), 3);          // completed
  assert.equal(cleanStatus(6), 6);          // not interested
  assert.equal(cleanStatus(8), 8);          // favourite only
  assert.equal(cleanStatus(8 | 1), 9);      // favourite + watching
  assert.equal(cleanStatus(7), 0);          // unknown status
  assert.equal(cleanStatus(15), 8);         // unknown status, favourite kept
  assert.equal(cleanStatus(99), 8);         // clamped to 15
  assert.equal(cleanStatus(-4), 0);
  assert.equal(cleanStatus('x'), 0);
});
