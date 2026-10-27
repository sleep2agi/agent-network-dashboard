/**
 * topology-3d —— 军团拓扑（等距版）的纯计算部分。
 *
 * 抽出来的原因：
 *   1. 组件只负责画，几何/分组逻辑要能单测（`app/lib/topology-3d.test.mjs`）；
 *   2. 布局必须**确定性**：dashboard 每 15s 刷新一次数据，如果顺序随人数变化，
 *      整张图会跟着跳。这里所有排序都基于稳定的字符串键，不依赖数值大小。
 */

export interface TopoSessionLike {
  alias: string;
  status?: string | null;
  node_id?: string | null;
  runtime?: string | null;
  agent?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
}

export interface TopoUnit<T extends TopoSessionLike = TopoSessionLike> {
  key: string;
  label: string;
  members: T[];
  colorIndex: number;
}

export const ISO_X = 0.866;
export const ISO_Y = 0.5;

/** 等距投影：把"地面坐标"映射到屏幕坐标 */
export function iso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * ISO_X, y: (x + y) * ISO_Y };
}

export function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return a.slice(0, i);
}

/**
 * 按 alias 公共前缀（≥2 字符）并组，与 2D 版口径一致。
 * 输出顺序**按 label 字典序**，不按人数——人数每轮都在变，按人数排会让整张图跳。
 */
export function computeUnits<T extends TopoSessionLike>(sessions: readonly T[]): TopoUnit<T>[] {
  const order = sessions
    .map((s, i) => ({ s, i }))
    .sort((x, y) => String(x.s.alias).localeCompare(String(y.s.alias)));

  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (let k = 0; k + 1 < order.length; k += 1) {
    const a = String(order[k].s.alias);
    const b = String(order[k + 1].s.alias);
    if (commonPrefix(a, b).length >= 2) union(order[k].i, order[k + 1].i);
  }

  const groups = new Map<number, T[]>();
  sessions.forEach((s, i) => {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(s);
    groups.set(root, arr);
  });

  const units: TopoUnit<T>[] = [];
  for (const members of groups.values()) {
    const sorted = members.slice().sort((x, y) => String(x.alias).localeCompare(String(y.alias)));
    const first = String(sorted[0].alias);
    const last = String(sorted[sorted.length - 1].alias);
    // 单成员组也要用「去掉尾号」的稳定名：否则组从 1 人变 2 人时 label 从「乙组1」跳到「乙组」，
    // 平台顺序会跟着变（dashboard 每 15s 刷新，看起来就是整张图在跳）。
    const stripTrailingNumber = (v: string): string => v.replace(/[0-9０-９]+$/, '').replace(/号$/, '');
    const label = sorted.length > 1
      ? (commonPrefix(first, last) || '未编队')
      : (stripTrailingNumber(first) || first.slice(0, 4) || '未编队');
    units.push({ key: label, label, members: sorted, colorIndex: 0 });
  }

  units.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  units.forEach((u, i) => { u.colorIndex = i; });
  return units;
}

/** 头像占位字：中文取首个汉字，其它取首字母大写 */
export function initialOf(alias: string): string {
  const s = String(alias ?? '').trim();
  if (!s) return '?';
  const cjk = s.match(/[\u4e00-\u9fa5]/);
  if (cjk) return cjk[0];
  return s[0].toUpperCase();
}

export interface GridPlan {
  shown: number;
  extra: number;
  rows: number;
}

/** 每个平台展示多少个头像、折叠多少个（纯函数，便于测） */
export function planGrid(total: number, perRow: number, maxPerUnit: number): GridPlan {
  const shown = Math.max(0, Math.min(total, maxPerUnit));
  const extra = Math.max(0, total - shown);
  const rows = perRow > 0 ? Math.ceil(shown / perRow) : 0;
  return { shown, extra, rows };
}
