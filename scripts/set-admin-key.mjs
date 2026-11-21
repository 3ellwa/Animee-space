// Makes a random admin key for /admin (answering requests, playback reports) and stores it as
// the ADMIN_KEY Worker secret. The key is shown once here: keep it in a password manager.
// Running it again replaces the key.
//
//   node scripts/set-admin-key.mjs

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const key = randomBytes(24).toString('base64url');
// Runs the project's own Wrangler through Node directly (no shell, so nothing gets re-parsed).
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const put = spawnSync(process.execPath, [WRANGLER, 'secret', 'put', 'ADMIN_KEY'], {
  input: key, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'],
});
if (put.status !== 0) {
  console.error('Setting ADMIN_KEY failed. Run `npx wrangler login` first, then try again.');
  process.exit(1);
}
console.log('✓ ADMIN_KEY set. Your admin key (shown only now, save it somewhere safe):\n');
console.log('   ' + key + '\n');
console.log('Open https://animee.space/admin and paste it.');
