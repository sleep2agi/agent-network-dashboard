#!/usr/bin/env node
/**
 * 门禁：构建产物不能进仓库。
 *
 * 2026-10-27 事故：发布时把旧构建备份成 `.next.prev-<ts>`，`.gitignore` 只忽略
 * `/.next/`，`git add -A` 把 271MB 构建缓存提交进仓库；Tailwind 扫源码树时读到
 * 里面的二进制缓存，生成了乱码类名，`next build` 直接失败（turbopack 与 webpack
 * 都一样）。表现很像 CSS 写坏了，实际是仓库里混进了构建产物。
 *
 * 这条门禁只看「被 git 跟踪的路径」，不与构建产物是否存在于工作区纠缠：
 * 构建产物当然会在工作区存在，但**绝不能出现在 index 里**。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN = [
  /^\.next\//,
  /^\.next\.prev-/,
  /^\.next\.[a-z]+-/,
  /^node_modules\//,
  /^\.turbo\//,
  /^dist\//,
  /^out\//,
];

let tracked = [];
try {
  tracked = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
} catch (e) {
  console.error('check-no-build-artifacts: 读不到 git index（跳过）:', String(e).slice(0, 100));
  process.exit(0);
}

const bad = tracked.filter(p => FORBIDDEN.some(re => re.test(p)));
if (bad.length > 0) {
  console.error(`✗ 构建产物被纳入版本控制：${bad.length} 个路径`);
  for (const p of bad.slice(0, 8)) console.error(`   ${p}`);
  console.error('  修法：git rm -r --cached <路径>，并把模式写进 .gitignore');
  process.exit(1);
}

console.log(`check-no-build-artifacts: ✓ 已跟踪文件 ${tracked.length} 个，无构建产物`);
