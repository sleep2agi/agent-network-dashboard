// 节点页相对时间的 hydration 契约（2026-11-11）
//
// 事故：/nodes 是唯一「服务端注入真实数据」的页面（.441 的外壳先到、数据后补）。
// 注入内容里包含 timeAgo(相对时间)，而相对时间依赖 Date.now()：
//   服务端在请求时刻算「3 分钟前」，客户端在 hydration 时刻算「4 分钟前」
// ⇒ 文本必然不同 ⇒ React #418（hydration 文本不匹配）⇒ 丢弃整棵服务端 DOM 重渲染
// ⇒ 用户可见后果：首屏白重绘一次，且 hydration 期间点击被吞（实测节点卡点不开）
//
// 修法：只对这三处时间文本标记 suppressHydrationWarning（相对时间天生非确定），
// 不把时间改成绝对时间（用户要的是"多久前"），也不全局抑制（其它真不匹配仍要报）。
//
// 这条测试锁住：
//   ① NodesView 里每个 timeAgo(...) 渲染点都必须带 suppressHydrationWarning
//   ② 标记数量与 timeAgo 渲染点数一致（防止新增一处忘了标记）

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('app/nodes/NodesView.tsx', root), 'utf8');

// 统计渲染期使用 timeAgo 的次数（排除 import 与类型引用）
const timeAgoUses = (src.match(/timeAgo\(/g) ?? []).length;
const suppressed = (src.match(/suppressHydrationWarning/g) ?? []).length;

assert.ok(timeAgoUses >= 3, `NodesView 至少三处渲染相对时间，实际 ${timeAgoUses}`);
assert.equal(
  suppressed,
  timeAgoUses,
  `每处 timeAgo 渲染都必须带 suppressHydrationWarning（timeAgo=${timeAgoUses}，标记=${suppressed}）`,
);

// 说明性注释必须留在源码里：否则后来者会以为这是随手加的
assert.match(
  src,
  /#418|hydration/i,
  '源码里必须保留「为什么加 suppressHydrationWarning」的说明（#418 / hydration）',
);

console.log('nodes relative-time hydration: PASS（三处相对时间均标记）');
