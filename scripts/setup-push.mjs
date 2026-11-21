// One-time setup for new-episode pop-ups (Web Push).
//
//   node scripts/setup-push.mjs          make the keys and store them as Worker secrets
//   node scripts/setup-push.mjs --force  replace existing keys (every device must turn pop-ups on again)
//
// Makes a P-256 key pair (VAPID) and stores both halves as secrets on the deployed Worker with
// `wrangler secret put`. The private key is piped straight to Wrangler and never printed or saved.

import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';

const force = process.argv.includes('--force');
const npx = (args, input) => spawnSync('npx', ['wrangler', ...args], {
  input, encoding: 'utf8', shell: process.platform === 'win32', stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
});

const list = npx(['secret', 'list', '--format', 'json']);
if (list.status !== 0) {
  console.error('Could not list the Worker\'s secrets. Run `npx wrangler login` first, then try again.');
  process.exit(1);
}
let existing = [];
try { existing = JSON.parse(list.stdout).map((s) => s.name); } catch { /* older Wrangler output */ }
if (existing.includes('VAPID_PRIVATE_KEY') && !force) {
  console.log('Pop-up keys are already set. Nothing changed.');
  console.log('To replace them, run with --force (every device then has to turn pop-ups on again).');
  process.exit(0);
}

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)); // 65 bytes
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const publicKey = Buffer.from(raw).toString('base64url');

for (const [name, value] of [['VAPID_PUBLIC_KEY', publicKey], ['VAPID_PRIVATE_KEY', jwk.d]]) {
  const put = npx(['secret', 'put', name], value);
  if (put.status !== 0) {
    console.error(`Setting ${name} failed:\n${put.stdout || ''}`);
    process.exit(1);
  }
  console.log(`✓ ${name} set`);
}
console.log('\nDone. Pop-ups are on: people can turn them on in Settings → Notifications on this device.');
