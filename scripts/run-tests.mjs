// 跑 tests/ 与 app/ 下的每一个 *.test.mjs / *.test.mts,并聚合结果。
//
// 这些断言此前**没有任何 CI 会跑**(#26)。gates.yml 只跑颜色棘轮与头像池,
// oss-gates.yml 只跑 lint + build —— 11 个测试文件一个都没被调用过。
//
// 🔴 这里必须按文件内容分派,任何单一命令都跑不全:
//
//   A. 自执行脚本(`tests/*.test.mjs` 那批):读源码做契约检查,自己 `process.exit(1)`。
//      → 直接 `node <file>`。用 `bun test` 跑会因为「没有 test() 调用」被判成空套件。
//
//   B. `node:test` 风格(`test()` / `afterEach()`):必须由测试 runner 驱动。
//      → `bun test <file>`。直接 `node <file>` 在 node 20 上有两个问题:
//         `.mts` 报 ERR_UNKNOWN_FILE_EXTENSION;而 `node:test` 的 `test()`
//         在非 runner 环境下会抛 "Cannot use test outside of the test runner"。
//      选 bun 而不是 `node --test` 是因为 `.mts` 需要类型擦除,
//      本机 node 是 20.x(`--experimental-strip-types` 要 22+)。
//
// 🔴 分母承重:扫不到文件就**退非零**。`0/0 passed` 和 `11/11 passed` 在日志里
//    是同一片绿 —— 目录改名、后缀改了、rebase 丢文件,都会让这道门变成安慰剂。
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = (process.env.TEST_DIRS || 'tests,app').split(',').filter(Boolean);
const SKIP = new Set(['node_modules', '.next', '.git', 'out', 'dist', 'android', 'ios']);

function find(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...find(p));
    else if (/\.test\.(mjs|mts)$/.test(e)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap(find).sort();
if (files.length === 0) {
  console.error(`✗ no *.test.{mjs,mts} found under ${ROOTS.join(', ')}/ — scope regression `
    + `(renamed dir? changed suffix? lost in a rebase?), refusing to pass`);
  process.exit(1);
}

let failed = 0;
// 🔴 两种 runner 的 import 都要认:`node:test` 和 `bun:test`。
// 第一版只写了 node:test,于是 app/lib/hub-upload-limits.test.mjs(它 import 的是
// `bun:test`)被分派给了 `node`,当场报
// "Cannot use afterEach() outside of the test runner" —— 10/11。
//
// 这个方向的错是**可见的**(文件红了)。反方向更危险:如果判据过宽,把一个自执行
// 脚本分派给 `bun test`,它会因为「没有 test() 调用」被判成空套件而**安静地通过**。
// 所以这里宁可窄一点、靠红来暴露,也不要宽到能吞掉一个文件。
const usesTestRunner = (f) => /from ['"](?:node|bun):test['"]|require\(['"](?:node|bun):test['"]\)/
  .test(readFileSync(f, 'utf8'));
for (const f of files) {
  const needsRunner = usesTestRunner(f);
  const [cmd, args] = needsRunner ? ['bun', ['test', f]] : ['node', [f]];
  console.log(`\n# ${f}   (${needsRunner ? 'bun test' : 'node'})`);
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n=== ${files.length - failed}/${files.length} test files passed `
  + `(${files.filter(usesTestRunner).length} via bun test, ${files.filter(f => !usesTestRunner(f)).length} self-executing) ===`);
process.exit(failed ? 1 : 0);
