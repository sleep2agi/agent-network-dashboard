#!/usr/bin/env node
/**
 * 硬编码「文字色」棘轮 —— 只准降，不准升。
 *
 * 背景：`--accent` / `--accent-text` 已经是主题化的正确入口，但组件里仍有
 * 106 处 `text-cyan-*` 这类写死的 Tailwind 文字色（其中一部分在浅色主题下
 * 对比度不够，只是还没被扫到 —— 那些页面/弹层不在 a11y:contrast 的页面清单里）。
 *
 * 一次性全改风险大（TopoGraph / Sidebar / TaskChatPanel 都在别人手上），所以
 * 这里先上棘轮：记录当前每个文件的计数做基线，新增就红，改少了提示收紧。
 * 目标是把「新增又写一个 text-cyan-300」这条路堵死，剩下的分页面慢慢迁到
 * `text-[var(--accent-text)]` 或语义 token。
 *
 * 用法：
 *   node scripts/check-accent-text-ratchet.mjs          # 校验
 *   node scripts/check-accent-text-ratchet.mjs --update # 收紧基线
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const BASELINE = join(ROOT, 'scripts', 'accent-text-baseline.json');
const PATTERN = /text-(?:cyan|purple|violet|sky|fuchsia)-\d{3}/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(entry)) out.push(p);
  }
  return out;
}

// 固定深色的品牌屏（不跟随主题）不算「写死文字色」债务，先豁免。
const EXEMPT = new Set(['app/login/page.tsx']);

const counts = {};
for (const file of walk(APP)) {
  if (EXEMPT.has(relative(ROOT, file))) continue;
  const src = readFileSync(file, 'utf8');
  const n = (src.match(PATTERN) || []).length;
  if (n > 0) counts[relative(ROOT, file)] = n;
}

const update = process.argv.includes('--update');
if (update || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify({ total: Object.values(counts).reduce((a, b) => a + b, 0), files: counts }, null, 2)}\n`);
  console.log(`accent-text-ratchet: baseline 写入（${Object.keys(counts).length} 个文件，共 ${Object.values(counts).reduce((a, b) => a + b, 0)} 处）`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const baseFiles = baseline.files || {};
let failures = 0;
for (const [file, n] of Object.entries(counts)) {
  const allowed = baseFiles[file] ?? 0;
  if (n > allowed) {
    failures++;
    console.error(`accent-text-ratchet: ${file} ${allowed} → ${n}（新增了写死的文字色；请用 text-[var(--accent-text)]）`);
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const improved = Object.entries(counts).some(([f, n]) => n < (baseFiles[f] ?? 0));
if (failures > 0) {
  console.error(`accent-text-ratchet: ${failures} 个文件超出基线（共 ${total} 处）`);
  process.exit(1);
}
console.log(`accent-text-ratchet: ✓ ${Object.keys(counts).length} 个文件、${total} 处，无新增${improved ? '（有文件低于基线，可 --update 收紧）' : ''}`);
