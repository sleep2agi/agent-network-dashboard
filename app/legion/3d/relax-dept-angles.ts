/**
 * 部门盘角度避让（.469，**3D 专用**）
 *
 * 背景（§89）：1440 上有 3 对深度重叠（−35 ~ −40px），全部是 **d2 ↔ d2**：
 * 同一深度环上、来自不同父部门的子部门撞在一起。共享布局 `legion-layout` 的
 * distribute() 是按「每个父部门的小扇区」切分的，跨父扇区之间没有避让机制。
 *
 * 为什么不改共享布局：2D 与 3D 共用它，改它等于把 2D 也拖进视觉回归，
 * 而 2D 版要保留（评审 2026-11-11）。所以避让只做在 3D：
 * **只调 angle，不动 radius / ring / 父子关系，回滚粒度是单个文件。**
 *
 * 判据（同一套会计口径，见 §88）：非空对碰撞数下降，且 ghost-overlap 不上升；
 * 2D 侧零改动（本文件只被 /legion/3d 引用）。
 */
import type { LegionNode } from '../../lib/legion-layout';

type GroupNode = LegionNode & { angle: number; radius: number; depth?: number };

const TAU = Math.PI * 2;

/** 与 legion-layout 的 polar() 完全一致：角度从 12 点起顺时针为正 */
function syncXY(n: GroupNode): void {
  n.x = n.radius * Math.sin(n.angle);
  n.y = -n.radius * Math.cos(n.angle);
}

/**
 * 不变量：布局里 angle/radius 与 x/y 必须满足 polar 派生关系。
 *
 * 3D 渲染只读 x/y（`nodeToVec3` 用 node.x / node.y），任何「只改了 angle 忘记同步 x/y」
 * 的改动都会静默失效 —— 2026-11-11 的盘避让就是这样一次（类型过、构建过、零效果）。
 * 守这条恒等式不需要知道读者读哪个字段，只需要它成立。
 *
 * @returns 最大偏差（世界坐标）；> 1e-9 即视为破坏
 */
export function polarMaxDeviation(nodes: LegionNode[]): number {
  let worst = 0;
  for (const n of nodes) {
    if (n.kind !== 'group') continue;
    const g = n as GroupNode;
    if (typeof g.angle !== 'number' || typeof g.radius !== 'number') continue;
    worst = Math.max(
      worst,
      Math.abs(g.x - g.radius * Math.sin(g.angle)),
      Math.abs(g.y + g.radius * Math.cos(g.angle)),
    );
  }
  return worst;
}

/** 与 3D 绘制一致的世界半径（与 legion-layout 的 deptWorldRadius 对齐） */
function deptWorldRadius(depth: number): number {
  return depth <= 1 ? 0.05 : 0.042;
}

/**
 * 对同深度、不同父部门的部门盘做角度松弛，减少投影后的重叠。
 *
 * @param nodes 布局节点（会被浅拷贝后修改 angle 的副本）
 * @param iterations 松弛轮数（实测 40 轮足够收敛，再多没有收益）
 */
export function relaxDepartmentAngles<T extends LegionNode>(nodes: T[], iterations = 40): T[] {
  const groups = nodes.filter((n): n is T & GroupNode => n.kind === 'group');
  if (groups.length < 2) return nodes;

  // 祖先链：父子嵌套是设计使然（父盘本来就包着子盘），不能当碰撞推开。
  const parentOf = new Map<string, string | null>();
  for (const g of groups) parentOf.set(g.id, (g as { parentId?: string | null }).parentId ?? null);
  const isAncestor = (a: string, b: string): boolean => {
    let cur: string | null | undefined = parentOf.get(b);
    for (let i = 0; i < 32 && cur; i += 1) {
      if (cur === a) return true;
      cur = parentOf.get(cur) ?? null;
    }
    return false;
  };

  const pairs: Array<[T & GroupNode, T & GroupNode]> = [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i];
      const b = groups[j];
      if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue; // 嵌套不算碰撞
      pairs.push([a, b]);
    }
  }
  if (pairs.length === 0) return nodes;

  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (const [a, b] of pairs) {
      const ra = deptWorldRadius(a.depth ?? 1);
      const rb = deptWorldRadius(b.depth ?? 1);
      const minDist = (ra + rb) * 1.15; // 两盘半径和 + 15% 余量
      const ax = a.radius * Math.sin(a.angle);
      const ay = -a.radius * Math.cos(a.angle);
      const bx = b.radius * Math.sin(b.angle);
      const by = -b.radius * Math.cos(b.angle);
      const dx = bx - ax;
      const dy = by - ay;
      const dist = Math.hypot(dx, dy);
      if (dist >= minDist) continue;
      if (dist < 1e-6) {
        // 完全同心：给一个确定的微小角差，避免除零并且可复现
        b.angle = (b.angle + 0.01) % TAU;
        syncXY(b);
        moved = true;
        continue;
      }
      const need = (minDist - dist) / Math.max(0.05, a.radius);
      const step = Math.min(0.02, need * 0.5);
      const da = ((a.angle - b.angle + Math.PI * 3) % TAU) - Math.PI; // (-π, π]
      const sign = da >= 0 ? 1 : -1;
      a.angle = (a.angle + sign * step + TAU) % TAU;
      b.angle = (b.angle - sign * step + TAU) % TAU;
      // 关键：3D 渲染走的是构建时写死的 x/y（nodeToVec3 只读 x/y），
      // 不是 angle/radius（§79 的「装配错位」：机制挂在了不参与渲染的字段上）。
      syncXY(a);
      syncXY(b);
      moved = true;
    }
    if (!moved) break;
  }

  // 收尾自检：派生关系必须成立（见 polarMaxDeviation 注释）。
  // 违反时只在开发期抛错，生产不打断渲染 —— 但仍会把偏差导出到 debug 通道。
  if (process.env.NODE_ENV !== 'production') {
    const dev = polarMaxDeviation(nodes);
    if (dev > 1e-6) throw new Error(`polar 不变量被破坏：max |Δ| = ${dev}`);
  }
  return nodes;
}
