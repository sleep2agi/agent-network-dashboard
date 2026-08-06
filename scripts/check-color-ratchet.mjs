#!/usr/bin/env node
// Color-class ratchet (issue #70 follow-up ②, 通信龙 dispatch 08-01).
//
// ~439 hardcoded Tailwind color classes (bg|text|border|ring)-[#hex] are
// being token-migrated in batches (batches 2-7). This ratchet keeps the
// number from growing WHILE the migration runs:
//   - per-file baseline (scripts/color-ratchet-baseline.json)
//   - FAIL only when a file exceeds its baseline or a NEW file introduces
//     hardcoded colors — it does NOT demand zero (an instantly-red gate
//     would just get disabled)
//   - improvements pass with a hint to tighten: node …/check-color-ratchet.mjs --update
//   - denominator always printed; scanning ZERO files is a scope
//     regression and FAILS (the "0 hits ≠ checked" lesson).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'color-ratchet-baseline.json');
// Two ratcheted families:
//   1. arbitrary hex classes (bg|text|border|ring)-[#…]
//   2. white/black opacity utilities (batch-3 "6th class"): bg-white/5 on a
//      light surface composites to a ~0 shift — theme-blind by construction.
//      Legit uses exist (modal backdrops, on-image chrome — 24 spots ruled
//      KEEP in batch 3), so like family 1 this only blocks INCREASES.
const RE = /(bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]|(bg|text|border|ring|divide)-(white|black)\/\d+/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.next') yield* walk(p); }
    else if (/\.tsx$/.test(name)) yield p;
  }
}

const counts = {};
let scanned = 0, total = 0;
for (const f of walk(join(ROOT, 'app'))) {
  scanned++;
  const n = (readFileSync(f, 'utf8').match(RE) || []).length;
  if (n > 0) { counts[relative(ROOT, f)] = n; total += n; }
}
if (scanned === 0) {
  console.error('color-ratchet: 🔴 scanned ZERO files — scope regression, refusing to pass.');
  process.exit(2);
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
  console.log(`color-ratchet: baseline updated — ${scanned} files scanned, ${total} hardcoded color classes across ${Object.keys(counts).length} files.`);
  process.exit(0);
}

let baseline;
try { baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')); }
catch {
  console.error(`color-ratchet: 🔴 baseline missing/unreadable at ${BASELINE_PATH}. Generate with --update.`);
  process.exit(2);
}

const regressions = [];
for (const [file, n] of Object.entries(counts)) {
  // Baseline omits zero-count files, so a missing entry means "was clean
  // (or didn't exist)" — either way its budget is 0.
  const base = baseline[file] ?? 0;
  if (n > base) regressions.push(`${file}: ${base} → ${n} (+${n - base})${baseline[file] === undefined ? ' (was clean/new)' : ''}`);
}
const improved = Object.entries(baseline).filter(([f, b]) => (counts[f] ?? 0) < b);

console.log(`color-ratchet: scanned ${scanned} files, ${total} hardcoded color classes (baseline ${Object.values(baseline).reduce((a, b) => a + b, 0)}).`);
if (regressions.length) {
  console.error('color-ratchet: 🔴 hardcoded color classes INCREASED — use the token table at the top of globals.css instead:');
  for (const r of regressions) console.error('  ' + r);
  process.exit(1);
}
if (improved.length) {
  console.log(`color-ratchet: ${improved.length} file(s) improved below baseline — tighten with: node scripts/check-color-ratchet.mjs --update`);
}
console.log('color-ratchet: ✓ no file exceeds its baseline.');
