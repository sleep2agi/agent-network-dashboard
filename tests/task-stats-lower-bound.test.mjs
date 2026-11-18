// `.615` 契约测试：把「上限冒充总数 → 显示 ≥N」这条判据钉在源码里
//
// 为什么用静态契约（而不是渲染测试）：这三处的正确性依赖"服务端截断时前端不能报确定值"，
// 而截断在本地很难稳定复现（需要 >200 条失败任务）。仓库里 alot of tests 也是这样做的：
// 断言"关键分支与文案还在"，防止后续重构把它们悄悄删掉。
//
// 对应线上实测（2026-11-18）：
//   /api/hub/tasks 单次最多回 200 条（limit=500 也只回 200，offset/page 被忽略）
//   /api/hub/tasks 的 count 也是"本次回了几条"
//   ⇒ 24h 失败数、任务列表总数在饱和时只能是下界，界面必须写 ≥
import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const read = (p) => {
  const u = new URL(p, root);
  assert.ok(existsSync(u), `${p} 必须存在`);
  return readFileSync(u, 'utf8');
};

// ── 1. 服务端：task-stats 必须走 parseHubTime，并在饱和时声明 truncated ──────────
const stats = read('app/api/hub/task-stats/route.ts');
assert.ok(/parseHubTime/.test(stats),
  'task-stats 必须用 parseHubTime 解析时间戳（裸 Date.parse 会按本地时区，偏 8 小时）');
assert.ok(/HUB_PAGE_CAP/.test(stats),
  'task-stats 必须保留页上限常量（CommHub 实测 200）');
assert.ok(/truncated/.test(stats) && /oldest/.test(stats),
  'task-stats 必须计算 truncated（列表顶到上限且最老一条仍在窗口内 ⇒ 只能给下界）');
assert.ok(/coveredFrom/.test(stats),
  'task-stats 应带出 coveredFrom，便于下游解释"这个数字覆盖了哪段时间"');

// ── 2. 首页横幅：截断时文案必须是 ≥N，不能是确定值 ──────────────────────────────
const banner = read('app/components/HealthBanner.tsx');
assert.ok(/truncated === true/.test(banner),
  '横幅必须读取接口的 truncated 标志');
assert.ok(/≥\$\{failed\}/.test(banner),
  '截断时横幅文案必须写成「≥N 个任务失败」');

// ── 3. 任务列表：饱和时显示 ≥N，并给出"为什么是下界"的说明 ─────────────────────
const tasks = read('app/tasks/TasksView.tsx');
assert.ok(/TASKS_PAGE_LIMIT/.test(tasks),
  '任务列表必须保留单页上限常量（请求参数与饱和判定共用，避免两处漂移）');
assert.ok(/totalSaturated/.test(tasks),
  '任务列表必须判定饱和（返回条数顶到上限且 count ≤ 返回条数）');
assert.ok(/'≥'/.test(tasks),
  '饱和时任务列表必须显示 ≥，不能把本页条数当总数');

// ── 4. 需求列表：加载期必须显示 —，不能显示 0 ────────────────────────────────
const requirements = read('app/requirements/page.tsx');
assert.ok(/countText/.test(requirements) && /'—'/.test(requirements),
  '需求页状态计数在未就绪时必须显示 —（否则「还不知道」会被读成 0）');

// ── 5. 加载态判据：用 loaded（data 是否到达），不是 isLoading ─────────────────
const hooks = read('app/lib/hooks.ts');
assert.ok(/loaded: data !== undefined/.test(hooks),
  'hooks 必须暴露 loaded —— SSR 首帧 isLoading 为 false，只判 loading 会渲染出 0');

console.log('task-stats ≥N 契约：PASS（5 组断言）');
