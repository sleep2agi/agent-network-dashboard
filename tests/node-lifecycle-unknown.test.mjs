// 节点可托管性的「未知」契约（2026-11-21，`.648`）
//
// 背景：Hub `/api/hub/nodes` 每个节点都带 `lifecycle_controllable`；生产实测 361 个节点
// 里 299 个是 false（`restart_readiness.path = 'manual'`）。`.646`/`.647` 让前端按这个
// 布尔判断「能不能在这里重启」，但两个入口都只处理了"值是 false"这一种情况：
//
//   线上实测（2026-11-21，dm.vansin.top，不可控节点「通信Mac马」）：
//     面板打开后 200ms / 600ms / 1200ms / 2500ms → 「重启节点」可点
//     5000ms                                     → 「需在所在机器上手动重启（未由 daemon 托管）」禁用
//
// 原因是 `controllableByAlias[alias]` 在节点列表返回之前是 `undefined`，而 undefined
// 被当成"旧接口，保持原行为"⇒ 前 3–4 秒仍是一个点了必然失败的按钮。
//
// 本测试锁的是**两种未知必须分开判断**：
//   A. 列表还没回来（loading）        → 禁用 + "正在读取可托管状态…"
//   B. 列表回来了但没有该字段（旧 Hub）→ 保持原行为（不禁用）
// 断言用结构标记（`nodesLoaded`、`controlLoading`、`controlUnknown`），不锁具体文案顺序。

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const hooks = readFileSync(new URL('app/lib/hooks.ts', root), 'utf8');
const panel = readFileSync(new URL('app/components/NodeSettingsPanel.tsx', root), 'utf8');
const menu = readFileSync(new URL('app/components/NodeLifecycleMenu.tsx', root), 'utf8');
const nodesView = readFileSync(new URL('app/nodes/NodesView.tsx', root), 'utf8');

// 1) hook 必须把"列表已加载"这个信号暴露出去，且判据是 data !== undefined
assert.ok(/nodesLoaded\s*=\s*data\s*!==\s*undefined/.test(hooks),
  'useNodeLifecycle 必须导出 nodesLoaded（data !== undefined），否则调用方分不清"读取中"与"旧接口"');
assert.ok(/nodesByServer,\s*nodesLoaded,/.test(hooks) || /nodesLoaded,/.test(hooks),
  'nodesLoaded 必须出现在 useNodeLifecycle 的返回值里');

// 2) 设置面板：读取中必须禁用，且判定条件必须同时看 canControl 与 nodesLoaded
assert.ok(/const controlUnknown\s*=\s*canControl === undefined && !nodesLoaded/.test(panel),
  'NodeSettingsPanel 必须把「canControl 未知且列表未加载」识别为读取中');
assert.ok(/disabled=\{lcBusy \|\| canControl === false \|\| controlUnknown\}/.test(panel),
  '重启按钮的 disabled 必须包含 controlUnknown（否则读取期间仍可点）');
assert.ok(/if \(canControl === false \|\| controlUnknown\) return;/.test(panel),
  'handleRestart 必须再挡一层，防止程序化/键盘触发绕过 disabled');

// 3) ⋮ 菜单：同样的两种未知要分开；调用方必须把 loading 传下来
assert.ok(/controlLoading\?:\s*boolean/.test(menu),
  'NodeLifecycleMenu 必须接收 controlLoading（列表未加载）');
assert.ok(/controlLoading && canControl === undefined/.test(menu),
  '菜单必须在 controlLoading 时给出读取态，而不是渲染可点的重启/停止/删除');
const callers = nodesView.split('canControl={controllableByAlias[s.alias]}').length - 1;
const withLoading = nodesView.split('controlLoading={!nodesLoaded && controllableByAlias[s.alias] === undefined}').length - 1;
assert.ok(callers >= 1 && callers === withLoading,
  `NodesView 的每个 NodeLifecycleMenu 调用点都要传 controlLoading（调用点 ${callers} 个，传了 ${withLoading} 个）`);

console.log(`node-lifecycle-unknown: PASS（${callers} 个菜单调用点都带上加载态）`);
