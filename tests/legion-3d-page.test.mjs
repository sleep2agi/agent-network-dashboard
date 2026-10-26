import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 3D 军团页的源码契约。
//
// 为什么不用 e2e 断言：3D 的正确性主要在**数学**（旋转矩阵、深度排序、
// 命中测试），那部分已经有 app/lib/legion-3d.test.mjs 的 10 条断言。
// 这里只钉住「页面必须守住的集成约束」——一旦有人图省事在组件里手写
// 三角函数、或塞进硬编码颜色，这里立刻红：
//   1. 坐标必须来自 lib（页面里不许出现 Math.sin/cos 画节点）；
//   2. 颜色必须来自 token（页面里不许出现 #rrggbb）；
//   3. 两页必须互达（/legion ↔ /legion/3d），否则新页面等于藏起来；
//   4. 画布必须有 aria-label（一张纯 canvas 对读屏是黑箱）；
//   5. 三态必须显式（空/401/500），不能用空态盖住故障。

const root = join(import.meta.dir, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

describe('军团 3D 页面契约', () => {
  const page = read('app/legion/3d/page.tsx');

  test('投影/命中一律来自 lib/legion-3d，页面不自己算三角函数', () => {
    expect(page).toContain("from '../../lib/legion-3d'");
    for (const fn of ['projectScene', 'projectPoint', 'hitTest', 'nodeToVec3', 'ringPath']) {
      expect(page).toContain(fn);
    }
    // 唯一允许的 sin/cos 是给装饰用的呼吸脉冲和流光，不能用来算节点坐标。
    const nodeMath = page.slice(page.indexOf('projectScene('), page.indexOf('screenRef.current = nodes'));
    expect(nodeMath).not.toContain('Math.sin');
    expect(nodeMath).not.toContain('Math.cos');
  });

  test('JSX 里不出现硬编码颜色（颜色只读 CSS 变量）', () => {
    // readTokens() 里的 hex 是「token 读不到时的兜底」，不是样式来源；
    // 真正要守的是渲染层：className / style 不许写死颜色。
    // 取最后一个顶层 `return (`：前面的 return 是 useEffect 的清理函数，
    // 用 indexOf 会把整个渲染循环都算进「JSX」。
    const jsx = page.slice(page.lastIndexOf('\n  return ('));
    expect(jsx).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(jsx).not.toMatch(/style=\{\{[^}]*:\s*['"](?:#|rgb)/);
    expect(page).toContain('readTokens');
    expect(page).toContain('--accent');
  });

  test('2D 与 3D 互达：/legion 有 3D 入口，3D 页有 2D 返回', () => {
    const twoD = read('app/legion/page.tsx');
    expect(twoD).toContain('href="/legion/3d"');
    expect(page).toContain('href="/legion"');
  });

  test('画布可访问：canvas 有 aria-label，舞台可聚焦（键盘旋转）', () => {
    expect(page).toMatch(/<canvas[\s\S]{0,700}aria-label=/);
    expect(page).toContain('tabIndex={0}');
    expect(page).toContain('onKeyDown');
  });

  test('三态互斥：空 / 登录过期 / 读取失败 各有独立分支', () => {
    expect(page).toContain("fatal === 'login'");
    expect(page).toContain("fatal === 'error'");
    expect(page).toContain('isEmpty');
    expect(page).toContain('<EmptyState');
    // 空态只在数据到位且节点确实只有圆心时出现，不在加载中显示。
    expect(page).toContain('!loading && !fatal');
  });
});
