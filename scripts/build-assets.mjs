// Regenerates worker-assets.js from the files in public/. Run with `npm run build`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const publicDir = join(root, 'public');
const walk = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);

// Images are stored as base64 ({ b64 }) and decoded by worker.js; everything else as text.
const BINARY = /\.(png|jpe?g|webp|ico|gif)$/i;
const assets = {};
for (const file of walk(publicDir).sort()) {
  const key = '/' + relative(publicDir, file).split(sep).join('/');
  assets[key] = BINARY.test(file) ? { b64: readFileSync(file).toString('base64') } : readFileSync(file, 'utf8');
}
writeFileSync(join(root, 'worker-assets.js'), 'export const ASSETS = ' + JSON.stringify(assets) + ';\n');
console.log('worker-assets.js: ' + Object.keys(assets).length + ' files');
