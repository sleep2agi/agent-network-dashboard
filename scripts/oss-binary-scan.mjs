#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const binaryExtensions = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.ico', '.jar', '.woff', '.woff2',
  '.ttf', '.otf', '.pdf', '.zip',
]);
const privateHostSuffixes = (process.env.OSS_PRIVATE_HOST_SUFFIXES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
for (const suffix of privateHostSuffixes) {
  if (!/^[a-z0-9.-]+$/.test(suffix) || suffix.startsWith('.') || suffix.endsWith('.')) {
    throw new Error(`invalid OSS_PRIVATE_HOST_SUFFIXES entry: ${suffix}`);
  }
}
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = [
  ['credential_shape', /ghp_[A-Za-z0-9]{20,}/],
  ['credential_shape', /github_pat_[A-Za-z0-9_]{20,}/],
  ['credential_shape', /(?:ntok|utok|atok)_[A-Za-z0-9]{16,}/],
  ['credential_shape', /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/],
  ['credential_shape', /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{20,}/],
  ['credential_shape', /(?:^|[^A-Z0-9])AKIA[0-9A-Z]{16}(?:[^A-Z0-9]|$)/],
  ['credential_shape', /AIza[0-9A-Za-z_-]{30,}/],
  ['credential_shape', /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ['credential_shape', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['personal_home', /(?:^|[^A-Za-z0-9])\/(?:home|Users)\/[A-Za-z0-9._-]+(?:\/|\b)/i],
  ...privateHostSuffixes.map((suffix) => [
    'personal_domain',
    new RegExp(`(?:^|[^A-Za-z0-9.-])(?:[A-Za-z0-9-]+\\.)*${escapeRegExp(suffix)}(?::\\d+)?(?:\\b|/)`, 'i'),
  ]),
];

const tracked = spawnSync('git', ['ls-files', '-z'], { encoding: 'buffer' });
if (tracked.status !== 0) {
  const detail = Buffer.concat([tracked.stderr ?? Buffer.alloc(0), tracked.stdout ?? Buffer.alloc(0)]).toString('utf8').trim();
  throw new Error(`git ls-files failed: ${detail}`);
}
const paths = tracked.stdout.toString('utf8').split('\0').filter(Boolean);
const binaryPaths = paths.filter((path) => {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && binaryExtensions.has(path.slice(dot).toLowerCase());
});
const findings = [];
for (const path of binaryPaths) {
  const bytes = readFileSync(path).toString('latin1');
  for (const [category, pattern] of patterns) {
    if (pattern.test(bytes)) findings.push({ category, path });
  }
}

console.log(`[oss-binary-scan] byte coverage: tracked_binary_files=${binaryPaths.length}`);
console.log(privateHostSuffixes.length > 0
  ? `[oss-binary-scan] private_host_suffixes: configured=${privateHostSuffixes.length}`
  : '[oss-binary-scan] private_host_suffixes: NOT CONFIGURED');
console.log('[oss-binary-scan] visual_and_compressed_semantics: NOT COVERED');
if (findings.length > 0) {
  console.error(`[oss-binary-scan] FAIL — ${findings.length} category/path finding(s)`);
  for (const finding of findings) console.error(`  ${finding.category}: ${finding.path}`);
  console.error('[oss-binary-scan] matched values are intentionally suppressed');
  process.exit(1);
}
console.log('[oss-binary-scan] PASS — no credential or private-path byte sequences found');
