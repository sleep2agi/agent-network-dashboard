#!/usr/bin/env node
/**
 * Avatar manifest checker (loop R38) — run `npm run avatars:check`.
 *
 * Validates public/avatars/manifest.json so the design team's illustration
 * drop lands with zero friction:
 *   - manifest parses and is a flat { "alias": "/path.png" } object
 *   - every value is a string path starting with "/"
 *   - referenced files exist under public/ (dangling → ERROR)
 *   - extension is png/jpg/jpeg/webp/svg (else WARN)
 *   - file size > 300 KB → WARN (avatars render at ≤44px)
 *   - files in public/avatars/ NOT referenced by the manifest → WARN (orphan)
 * Exit code 1 on any ERROR, 0 otherwise.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
const manifestPath = join(pub, 'avatars', 'manifest.json');

let errors = 0, warns = 0;
const err = (m) => { errors++; console.log(`  ERROR ${m}`); };
const warn = (m) => { warns++; console.log(`  warn  ${m}`); };

if (!existsSync(manifestPath)) {
  console.log('no public/avatars/manifest.json — nothing to check (avatars fall back to pills)');
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  err(`manifest.json does not parse: ${e.message}`);
  process.exit(1);
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  err('manifest must be a flat object of { "alias": "/path" }');
  process.exit(1);
}

const okExt = /\.(png|jpe?g|webp|svg)$/i;
const referenced = new Set();

// "_pool": array of shared illustrations hash-assigned to unlisted aliases.
const checkPath = (label, value) => {
  const file = join(pub, value.replace(/^\//, ''));
  referenced.add(resolve(file));
  if (!existsSync(file)) { err(`${label}: ${value} → file missing under public/`); return; }
  if (!okExt.test(value)) warn(`${label}: ${value} has unusual extension`);
  const kb = Math.round(statSync(file).size / 1024);
  if (kb > 300) warn(`${label}: ${value} is ${kb} KB (avatars render ≤44px — consider downscaling)`);
};
let poolCount = 0;
if ('_pool' in manifest) {
  if (!Array.isArray(manifest._pool)) {
    err('"_pool" must be an array of "/..." paths');
  } else {
    for (const p of manifest._pool) {
      if (typeof p !== 'string' || !p.startsWith('/')) { err(`"_pool" entry must be a string path starting with "/" (got ${JSON.stringify(p)})`); continue; }
      checkPath('"_pool"', p);
      poolCount++;
    }
  }
  delete manifest._pool;
}

for (const [alias, value] of Object.entries(manifest)) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    err(`"${alias}": value must be a string path starting with "/" (got ${JSON.stringify(value)})`);
    continue;
  }
  const file = join(pub, value.replace(/^\//, ''));
  referenced.add(resolve(file));
  if (!existsSync(file)) { err(`"${alias}": ${value} → file missing under public/`); continue; }
  if (!okExt.test(value)) warn(`"${alias}": ${value} has unusual extension`);
  const kb = Math.round(statSync(file).size / 1024);
  if (kb > 300) warn(`"${alias}": ${value} is ${kb} KB (avatars render ≤44px — consider downscaling)`);
}

const avatarDir = join(pub, 'avatars');
for (const f of readdirSync(avatarDir)) {
  if (f === 'manifest.json' || f === 'README.md') continue;
  if (!referenced.has(resolve(join(avatarDir, f)))) warn(`public/avatars/${f} is not referenced by the manifest (orphan)`);
}

console.log(`checked ${Object.keys(manifest).length} alias entries + ${poolCount} pool illustrations: ${errors} error(s), ${warns} warning(s)`);
process.exit(errors ? 1 : 0);
