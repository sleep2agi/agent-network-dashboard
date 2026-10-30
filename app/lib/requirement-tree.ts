/**
 * Sub-requirement tree over the rows already loaded.
 *
 * The Hub list has no parent/child ordering switch, so this is a pure client
 * view: roots first, children nested under their parent (up to five levels),
 * collapsed subtrees hidden. A row whose parent is not loaded stays a root —
 * the view never invents an ancestor it cannot see.
 */

export interface TreeRow<T> {
  row: T;
  depth: number;
  hasChildren: boolean;
}

interface HasParent {
  id: string;
  parent_id?: string | null;
}

export function buildTreeRows<T extends HasParent>(
  rows: readonly T[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeRow<T>[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    const parent = row.parent_id;
    if (parent && parent !== row.id && byId.has(parent)) {
      const bucket = children.get(parent) ?? [];
      bucket.push(row);
      children.set(parent, bucket);
    } else {
      roots.push(row);
    }
  }
  const out: TreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (row: T, depth: number) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const kids = children.get(row.id) ?? [];
    out.push({ row, depth, hasChildren: kids.length > 0 });
    if (collapsed.has(row.id)) {
      // 折叠：子树只是不画，但仍要标记为已处理，免得末尾的兜底逻辑把它们当根补回来。
      const mark = (parent: T) => {
        for (const child of children.get(parent.id) ?? []) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          mark(child);
        }
      };
      mark(row);
      return;
    }
    for (const child of kids) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // 数据里若存在环，剩下的行仍要显示：按原顺序补在末尾，最多 5 层。
  for (const row of rows) if (!seen.has(row.id)) walk(row, 0);
  return out;
}
