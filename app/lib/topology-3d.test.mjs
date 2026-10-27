// topology-3d 纯函数单测（自执行脚本，`node app/lib/topology-3d.test.mjs`）
//
// 这道门保护三件真实发生过/容易发生的事：
//   1. 布局随人数变化 → dashboard 15s 刷新一次，整张图会跳（按 label 排序才对）
//   2. 前缀并组把不相关的节点并成一坨（阈值必须 ≥2 字符）
//   3. 头像溢出（每个平台最多 maxPerUnit 个，其余必须折叠成 +N）

import { computeUnits, initialOf, planGrid, iso, commonPrefix } from './topology-3d.ts';

let pass = 0, total = 0;
function ck(name, cond) {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name);
}

const S = (alias, extra = {}) => ({ alias, status: 'idle', ...extra });

// ── 前缀并组 ─────────────────────────────────────────────
{
  const units = computeUnits([S('通信欧'), S('通信牛'), S('TMWork甲'), S('TMWork乙'), S('独行侠')]);
  const byLabel = Object.fromEntries(units.map(u => [u.label, u.members.length]));
  ck('同前缀（≥2）并成一组', byLabel['通信'] === 2);
  ck('另一前缀独立成组', byLabel['TMWork'] === 2);
  ck('无公共前缀的独立成组', Object.values(byLabel).filter(n => n === 1).length === 1);
  ck('分组总数 = 3', units.length === 3);
}

// ── 排序稳定性（关键）────────────────────────────────────
{
  const a = computeUnits([S('乙组1'), S('甲组1'), S('丙组1')]).map(u => u.label);
  const b = computeUnits([S('丙组1'), S('甲组1'), S('乙组1')]).map(u => u.label);
  ck('输入顺序不影响分组顺序', JSON.stringify(a) === JSON.stringify(b));
  ck('按 label 字典序（不是人数）', a[0] === [...a].sort((x, y) => x.localeCompare(y))[0]);

  // 人数变化不能让顺序变
  const few = computeUnits([S('甲组1'), S('乙组1'), S('乙组2'), S('乙组3')]).map(u => u.label);
  const more = computeUnits([S('甲组1'), S('乙组1')]).map(u => u.label);
  ck('成员增减不改变平台顺序', JSON.stringify(few) === JSON.stringify(more));
}

// ── 前缀阈值 ─────────────────────────────────────────────
{
  ck('公共前缀 1 字符不算同组', computeUnits([S('甲A'), S('乙B')]).length === 2);
  ck('commonPrefix 基本正确', commonPrefix('TMWork甲', 'TMWork乙') === 'TMWork');
  ck('commonPrefix 无公共前缀返回空', commonPrefix('abc', 'xyz') === '');
}

// ── 头像折叠 ─────────────────────────────────────────────
{
  ck('20 个以内全展示', planGrid(13, 5, 20).shown === 13 && planGrid(13, 5, 20).extra === 0);
  ck('超过上限折叠 +N', planGrid(36, 5, 20).shown === 20 && planGrid(36, 5, 20).extra === 16);
  ck('行数按 perRow 上取整', planGrid(13, 5, 20).rows === 3);
  ck('空组不崩', planGrid(0, 5, 20).rows === 0);
  ck('perRow=0 不产生 Infinity', planGrid(10, 0, 20).rows === 0);
}

// ── 占位字 ───────────────────────────────────────────────
{
  ck('中文取首字', initialOf('通信欧') === '通');
  ck('英文取首字母大写', initialOf('opencode') === 'O');
  ck('空 alias 不崩', initialOf('') === '?');
  ck('undefined 不崩', initialOf(undefined) === '?');
}

// ── 等距投影 ─────────────────────────────────────────────
{
  const o = iso(0, 0);
  ck('原点映射到原点', Math.abs(o.x) < 1e-9 && Math.abs(o.y) < 1e-9);
  const right = iso(100, 0);
  ck('x 轴向右下（等距特征）', right.x > 0 && right.y > 0);
  const down = iso(0, 100);
  ck('y 轴向左下', down.x < 0 && down.y > 0);
}

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
