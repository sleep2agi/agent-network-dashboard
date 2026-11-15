// 圆心短名契约（2026-11-15，`.573`）
//
// 事故：直方图里的部门圆心写的是「按字符数硬切」——
//   ANet        → ANe      （看起来像拼错的公司名）
//   TMAI        → TMA
//   无主 Agent  → 无主A    （中英混切，读不出意思）
// 这是页面上最显眼的元素（14 个部门圆心），肉眼一眼就能看到"错字"。
//
// 本测试钉住三件事：
//   ① 短名必须在「中文/西文」交界断开，不许把一个西文词从中间切断
//   ② 纯西文短名（≤4 字符，如 ANet / TMAI）必须整词保留 —— 字形窄，放得下
//   ③ 圆心不许为空；预算很小时也要给出开头几个字
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const { legionCircleBudget, legionCircleName } = await import('../app/lib/legion-labels.ts');

// —— ① 中英混排：在交界处断开
assert.equal(legionCircleName('无主 Agent', 3), '无主', '无主 Agent 应断在空格/中英交界，得「无主」');
assert.equal(legionCircleName('无主 Agent', 2), '无主', '小预算同样应得「无主」');
assert.equal(legionCircleName('B站', 3), 'B站', '中英混排但整体很短时应完整保留');
assert.equal(legionCircleName('A站', 2), 'A站', '两字符预算下 A站 完整');

// —— ② 纯西文：整词保留（此前被切成 ANe / TMA）
assert.equal(legionCircleName('ANet', 3), 'ANet', 'ANet 不应被切成 ANe');
assert.equal(legionCircleName('ANet', 2), 'ANet', '小预算下纯西文短词仍整词保留');
assert.equal(legionCircleName('TMAI', 3), 'TMAI', 'TMAI 不应被切成 TMA');
assert.equal(legionCircleName('TM', 2), 'TM');

// —— ③ 不空、不越界
assert.equal(legionCircleName('', 3), '', '空标签给空串，不画字');
assert.equal(legionCircleName('**', 3), '', '只有符号的标签给空串');
assert.equal(legionCircleName('无分组', 3), '无分组', '三个中文字正好放得下');
assert.equal(legionCircleName('无分组说明', 3), '无分组', '超出预算时在第三字处停，不硬塞第四字');
assert.ok(legionCircleName('AnthropicAI', 2).length > 0, '超长西文名在小预算下也要有开头（圆心不许空）');
assert.ok(legionCircleName('AnthropicAI', 3).length <= 5, '超长西文名按预算只取开头（11 字符不会整词塞进圆里）');
assert.equal(legionCircleName('ANet', 0), '', '预算为 0 时不画');

// —— ④ 预算按圆的像素宽度算，不再硬编码 3/2 字
// 1366 实测：rx≈25、fs≈11.5 → 预算 ≈3.8 → 三个中文字放得下（旧写法切成「未分」）
assert.ok(legionCircleBudget(25, 11.5) >= 3, '1366 的部门圆应容得下三个中文字');
assert.ok(legionCircleName('未分组', legionCircleBudget(25, 11.5)) === '未分组', '1366 下「未分组」不许被切成「未分」');
assert.ok(legionCircleBudget(28, 13) >= 3, '1920 的部门圆预算同样 ≥3');
assert.equal(legionCircleName('无主 Agent', legionCircleBudget(28, 13)), '无主', '1920 下仍是「无主」而不是「无主Agent」');
assert.ok(legionCircleBudget(9, 11) < 2, '小圆（rx 9）只给 1 个字左右的预算，避免溢出');
assert.equal(legionCircleBudget(0, 11), 0, '半径非正时预算为 0');
assert.equal(legionCircleBudget(25, 0), 0, '字号非正时预算为 0');
assert.ok(legionCircleBudget(400, 11) <= 4, '预算上限 4，避免大圆里铺满整句');

// —— 页面必须真的用这个函数，而不是又写回 slice(0, 3)
const page = read('app/legion/3d/page.tsx');
assert.match(page, /legionCircleName\(node\.label, legionCircleBudget\(/, 'page.tsx 必须用 legionCircleBudget 计算预算后调用 legionCircleName');
assert.ok(!/rx >= 28 \? 3 : 2/.test(page), 'page.tsx 不许再出现硬编码的 3/2 字预算');
assert.ok(!/slice\(0, rx >= 28 \? 3 : 2\)/.test(page), 'page.tsx 不许回到按字符数硬切的写法');

const lib = read('app/lib/legion-labels.ts');
assert.match(lib, /export function legionCircleName/, 'legion-labels.ts 必须导出 legionCircleName');

console.log('=== legion-circle-name: 22/22 断言通过（中英交界断开 · 西文整词 · 圆心不空 · 预算按像素 · 页面已接线）===');
