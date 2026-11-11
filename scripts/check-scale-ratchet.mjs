// 圆角 / 字号刻度棘轮（2026-11-11，#3083；配套 docs/design-scale-migration-plan-20261104.md）
//
// 为什么先装门禁再迁移：迁移期间如果还在新增偏离刻度的写法，永远收敛不了。
// 规则：与基线比较，超过 ⇒ 失败；低于 ⇒ 提示可下调基线。
// 口径：统计前先剥注释（块注释 + 整行 //），行内 // 不截断（可能是 URL）。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE_PATH = join(ROOT, 'scripts', 'scale-ratchet-baseline.json');

function stripComments(text) {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      return !(s.startsWith('//') || s.startsWith('*'));
    })
    .join('\n');
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts|css)$/.test(name)) out.push(p);
  }
  return out;
}

const OFF_SCALE = [
  { key: 'rounded-md', re: /rounded-md\b/g, note: '6px 不在刻度内（最近档 8px）' },
  { key: 'text-[9px]', re: /text-\[9px\]/g, note: '9px 不在字号刻度内' },
  { key: 'text-[10px]', re: /text-\[10px\]/g, note: '10px 不在字号刻度内' },
];

const counts = {};
let scanned = 0;
for (const file of walk(join(ROOT, 'app'))) {
  scanned += 1;
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const { key, re } of OFF_SCALE) {
    const n = (src.match(re) || []).length;
    if (n) counts[key] = (counts[key] || 0) + n;
  }
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};
const problems = [];
const improvements = [];
for (const { key, note } of OFF_SCALE) {
  const now = counts[key] || 0;
  const limit = baseline[key];
  if (typeof limit !== 'number') { problems.push(`${key}: 基线缺失（${note}）`); continue; }
  if (now > limit) problems.push(`${key}: 现在 ${now}，基线 ${limit}（新增了偏离刻度的用法）`);
  else if (now < limit) improvements.push(`${key}: 现在 ${now}，基线 ${limit}（有进展，可下调基线）`);
}

console.log(`scale-ratchet: 扫描 ${scanned} 个文件`);
for (const { key } of OFF_SCALE) console.log(`  ${key}: ${counts[key] || 0}`);
for (const msg of improvements) console.log(`  ↓ ${msg}`);
if (problems.length) {
  console.error('\nSCALE-RATCHET FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('scale-ratchet: OK');
