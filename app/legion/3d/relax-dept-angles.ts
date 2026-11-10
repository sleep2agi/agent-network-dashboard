/**
 * 部门盘角度避让（3D 专用）
 *
 * 背景（§89）：1440 上有 3 对深度重叠（−35 ~ −40px），全部是 **d2 ↔ d2**：
 * 同一深度环上、来自不同父部门的子部门撞在一起。共享布局 `legion-layout` 的
 * distribute() 是按「每个父部门的小扇区」切分的，跨父扇区之间没有避让机制。
 *
 * 为什么不动共享布局：2D 与 3D 共用它，改它等于把 2D 也拖进视觉回归，
 * 而 2D 版要保留（评审 2026-11-11）。所以避让只做在 3D：
 * **只调 angle，绝不动 radius / ring / 父子关系。**
 *
 * 为什么不是「逐对推开」（.469 的做法）：对角推开会在三盘互挤处停下（局部最优），
 * 且只对默认视角有效。这里改成**全局目标**：对所有「非祖孙」的盘对求
 * Σ(重叠量)²，用坐标下降+多步长搜索整体下降，跨视角一起受益。
 *
 * 三条不变量（判据，见 §90）：
 *   1. polarDev   = max|x−r·sin a|, |y+r·cos a|  ≡ 0（派生关系自洽，渲染读的是 x/y）
 *   2. radiusShift= max|Δr| ≡ 0（半径=层级是主编码，不许拿来换观感）
 *   3. maxAngleΔ  ≤ 0.45 rad（约 26°：部门不至于跑到别人的扇区去）
 */
import type { LegionNode } from '../../lib/legion-layout';

type GroupNode = LegionNode & { angle: number; radius: number; depth?: number };

const TAU = Math.PI * 2;

/** 单节点允许的最大角度位移（rad）。超过就会明显跑到别的扇区。 */
export const MAX_ANGLE_DELTA = 0.8;

function syncXY(n: GroupNode): void {
  n.x = n.radius * Math.sin(n.angle);
  n.y = -n.radius * Math.cos(n.angle);
}

/** 与 legion-layout 的 deptWorldRadius 保持一致 */
function deptWorldRadius(depth: number): number {
  return depth <= 1 ? 0.05 : 0.042;
}

export interface RelaxStats {
  /** 半径最大偏移（必须为 0：半径编码层级，不许改） */
  radiusShift: number;
  /** 角度最大位移（rad） */
  maxAngleDelta: number;
  /** 世界坐标下「非祖孙盘对」的重叠总量（优化目标，越小越好） */
  overlapBefore: number;
  overlapAfter: number;
  /** 仍重叠的盘对数与最深值（世界单位） */
  overlappingPairs: number;
  deepest: number;
}

let lastStats: RelaxStats = {
  radiusShift: 0,
  maxAngleDelta: 0,
  overlapBefore: 0,
  overlapAfter: 0,
  overlappingPairs: 0,
  deepest: 0,
};

export function getLastRelaxStats(): RelaxStats {
  return lastStats;
}

/** 派生关系偏差（不变量 1） */
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

function buildPairs(groups: GroupNode[]): Array<[GroupNode, GroupNode]> {
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
  const pairs: Array<[GroupNode, GroupNode]> = [];
  for (let i = 0; i < groups.length; i += 1) {
    for (let j = i + 1; j < groups.length; j += 1) {
      const a = groups[i];
      const b = groups[j];
      // 父子嵌套是设计使然（父盘本来就包着子盘），不能当碰撞推
      if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * 绘制半径 ≠ 世界半径：`departmentDisc()` 把世界半径乘了 **2.1** 再投影
 * （app/lib/legion-3d.ts: `rx = max(MIN_RX, 2.1 * radius)`，ry 再乘长宽比）。
 *
 * 2026-11-11 教训：第一版按世界半径求最小间距，模型比实际盘小 1.8 倍，
 * 于是「世界坐标已完全分开」但屏幕上仍然大幅重叠（realN 5 对、−23.9px）。
 * 这就是又一次「模型 ≠ 渲染器」——判据必须用渲染器真正画多大。
 */
const DISC_SCREEN_SCALE = 2.1;

function minDistOf(a: GroupNode, b: GroupNode): number {
  const ra = deptWorldRadius(a.depth ?? 1) * DISC_SCREEN_SCALE;
  const rb = deptWorldRadius(b.depth ?? 1) * DISC_SCREEN_SCALE;
  // 椭圆盘在竖直方向被压扁（ry = aspect * rx），按 rx 之和留 5% 余量最保守
  return (ra + rb) * 1.05;
}

/**
 * 目标函数：Σ 重叠² + 30·最深重叠²
 *
 * 为什么不是纯平方和（2026-11-11 实测）：纯平方和会把「一对深重叠」换成
 * 「多对浅重叠」——总代价下降，但屏幕上的**最差那一对反而更深**
 * （1440@0.666 从 −31.7 恶化到 −41.2，而总对数从 5 降到 4）。
 * 人眼看到的是「最深的那一处糊」，所以必须对最深值加权。
 */
const PEAK_WEIGHT = 30;

function overlapCost(pairs: Array<[GroupNode, GroupNode]>): number {
  let cost = 0;
  let peak = 0;
  for (const [a, b] of pairs) {
    const ax = a.radius * Math.sin(a.angle);
    const ay = -a.radius * Math.cos(a.angle);
    const bx = b.radius * Math.sin(b.angle);
    const by = -b.radius * Math.cos(b.angle);
    const d = Math.hypot(bx - ax, by - ay);
    const over = minDistOf(a, b) - d;
    if (over > 0) {
      cost += over * over;
      if (over > peak) peak = over;
    }
  }
  return cost + PEAK_WEIGHT * peak * peak;
}

/**
 * 全局角度优化：坐标下降 + 多步长。
 * 为什么不随机退火：固定步长序列 + 固定遍历顺序 ⇒ 结果可复现，
 * 同一份数据每次构建得到同一张图（否则截图对照与回归会抖）。
 */
export function relaxDepartmentAngles<T extends LegionNode>(nodes: T[]): T[] {
  const groups = nodes.filter((n): n is T & GroupNode => n.kind === 'group');
  if (groups.length < 2) return nodes;

  const radiusBefore = new Map<string, number>();
  const angleBefore = new Map<string, number>();
  for (const g of groups) {
    radiusBefore.set(g.id, g.radius);
    angleBefore.set(g.id, g.angle);
  }

  const pairs = buildPairs(groups);
  const overlapBefore = overlapCost(pairs);

  const steps = [0.08, 0.04, 0.02, 0.01, 0.005];
  for (let s = 0; s < steps.length; s += 1) {
    const step = steps[s];
    for (let pass = 0; pass < 6; pass += 1) {
      let improved = false;
      for (const g of groups) {
        const base = angleBefore.get(g.id) ?? g.angle;
        const current = g.angle;
        let best = current;
        let bestCost = overlapCost(pairs);
        for (const dir of [1, -1]) {
          const candidate = current + dir * step;
          // 约束：不许跑出自己的扇区太远
          const delta = Math.abs(((candidate - base + Math.PI * 3) % TAU) - Math.PI);
          if (delta > MAX_ANGLE_DELTA) continue;
          g.angle = (candidate + TAU) % TAU;
          const cost = overlapCost(pairs);
          if (cost < bestCost - 1e-12) {
            bestCost = cost;
            best = g.angle;
            improved = true;
          }
        }
        g.angle = best;
        syncXY(g);
      }
      if (!improved) break;
    }
  }

  // 收尾同步（坐标下降过程中每次落定都会 syncXY，这里兜底）
  for (const g of groups) syncXY(g);

  const overlapAfter = overlapCost(pairs);
  let radiusShift = 0;
  let maxAngleDelta = 0;
  for (const g of groups) {
    const r0 = radiusBefore.get(g.id);
    if (typeof r0 === 'number') radiusShift = Math.max(radiusShift, Math.abs(g.radius - r0));
    const a0 = angleBefore.get(g.id);
    if (typeof a0 === 'number') {
      const d = Math.abs(((g.angle - a0 + Math.PI * 3) % TAU) - Math.PI);
      maxAngleDelta = Math.max(maxAngleDelta, d);
    }
  }
  let overlappingPairs = 0;
  let deepest = 0;
  for (const [a, b] of pairs) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const over = minDistOf(a, b) - d;
    if (over > 0) {
      overlappingPairs += 1;
      deepest = Math.max(deepest, over);
    }
  }

  lastStats = {
    radiusShift,
    maxAngleDelta,
    overlapBefore,
    overlapAfter,
    overlappingPairs,
    deepest,
  };

  // 不变量 1：派生关系必须成立（生产不打断渲染，只导出偏差）
  if (process.env.NODE_ENV !== 'production') {
    const dev = polarMaxDeviation(nodes);
    if (dev > 1e-6) throw new Error(`polar 不变量被破坏：max |Δ| = ${dev}`);
  }

  return nodes;
}
