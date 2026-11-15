// 需求状态芯片中文化契约（2026-11-15，`.574`）
//
// 事故：需求列表行与详情页直接渲染 `column` 原值，界面上出现 done / doing / pool，
//       而同一页的筛选器写的是「需求池 / 进行中 / 完成」。
//       文案门没抓到，因为它把整行（[data-requirement-id] / article）当正文跳过了。
//
// 本测试钉三件事：
//   ① 中文名只有一份来源（lib/status.ts 的 REQUIREMENT_COLUMN_LABEL）
//   ② 界面不许再直接渲染 {row.column} / {req.column} 原文
//   ③ 状态芯片必须带 data-status-chip —— 这是文案门"内容行里也要扫它"的挂钩
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const statusLib = read('app/lib/status.ts');
assert.match(statusLib, /export const REQUIREMENT_COLUMN_LABEL/, 'lib/status.ts 必须导出 REQUIREMENT_COLUMN_LABEL');
for (const [k, zh] of [['pool', '需求池'], ['doing', '进行中'], ['done', '完成'], ['abandoned', '已放弃']]) {
  assert.ok(new RegExp(`${k}: '${zh}'`).test(statusLib), `${k} 必须映射为「${zh}」`);
}

const list = read('app/requirements/page.tsx');
assert.match(list, /REQUIREMENT_COLUMN_LABEL\[row\.column\]/, '列表行芯片必须走中文映射');
// 注意：data-column={row.column} 是合法属性（给样式/探针用），只禁止"当文本渲染"
assert.ok(!/(?<![=\w])\{row\.column\}/.test(list), '列表行不许直接渲染 row.column 原值（属性 data-column= 除外）');
assert.ok(/data-status-chip/.test(list), '列表状态芯片必须带 data-status-chip（供文案门取样）');
assert.ok(/REQUIREMENT_COLUMN_LABEL\.pool/.test(list), '筛选器 COLUMNS 应复用同一份中文映射，不再各写一遍');

const detail = read('app/requirements/[id]/page.tsx');
assert.ok(!/(?<![=\w])\{req\.column\}/.test(detail), '详情页不许直接渲染 req.column 原值（属性除外）');
assert.ok(!/(?<![=\w])\{row\.column\}/.test(detail), '详情页子需求/父级列表不许直接渲染 row.column 原值（属性除外）');
assert.ok(/开始 \{String\(req\.start\)/.test(detail), '详情页日期标签应为「开始」而不是 start');
assert.ok(/截止 \{String\(req\.due\)/.test(detail), '详情页日期标签应为「截止」而不是 due');
assert.match(detail, /REQUIREMENT_COLUMN_LABEL/, '详情页必须使用同一份中文映射');

console.log('=== requirement-column-label: 14/14 断言通过（单一来源 · 不再渲染枚举原文 · 芯片可被门取样 · 日期中文化）===');
