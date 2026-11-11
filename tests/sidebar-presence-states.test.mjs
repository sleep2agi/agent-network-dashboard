// 侧栏在线状态的三态契约（2026-11-11，#3985）
//
// 事故：加载期间侧栏显示「waiting for agents」，用户据此以为舰队为空；
//      接口失败时也可能伪装成空态。修好后用这条测试锁住「分支顺序」：
//        1) 加载中（isLoading && total===0） → loading…
//        2) 失败（error && total===0）      → status unavailable
//        3) 真空（total===0）               → waiting for agents
//        4) 有数据                          → N/M online
//
// 断言的是**语义顺序**（先判加载、再判失败、最后才是空），不是具体写法：
// 只要有人把「空态」提到「加载/失败」之前，这条就会红。

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('app/components/Sidebar.tsx', root), 'utf8');

// 定位四段文案在文件中的顺序（用文本位置代表分支顺序）
const pos = {
  loading: src.indexOf('loading…'),
  unavailable: src.indexOf('status unavailable'),
  waiting: src.indexOf('waiting for agents'),
  online: src.indexOf(' online</span>'),
};

assert.ok(pos.loading > 0, '必须存在「loading…」态（加载中不得冒充空态）');
assert.ok(pos.unavailable > 0, '必须存在「status unavailable」态（失败不得冒充空态）');
assert.ok(pos.waiting > 0, '必须保留「waiting for agents」（真正的空态）');
assert.ok(pos.online > 0, '必须存在有数据态');

assert.ok(
  pos.loading < pos.waiting,
  '「loading…」分支必须出现在「waiting for agents」之前（否则加载期会显示空态文案）',
);
assert.ok(
  pos.unavailable < pos.waiting,
  '「status unavailable」分支必须出现在「waiting for agents」之前（否则失败会显示空态文案）',
);

// 三态必须由不同条件驱动：isLoading / error / total===0
assert.match(src, /isLoading && total === 0/, '加载态必须由 isLoading && total===0 驱动');
assert.match(src, /error && total === 0/, '失败态必须由 error && total===0 驱动');
assert.match(src, /total === 0 \?/, '空态必须由 total===0 驱动');

console.log('sidebar presence states: PASS（loading / unavailable / empty 顺序正确）');
