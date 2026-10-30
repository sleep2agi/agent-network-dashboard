/**
 * Tag management — the write side of the Hub catalogue
 * (`POST /api/requirements/tags/ops`), mirroring APP `task-tag-catalog`.
 *
 * Only ops the Hub documents are built here: rename, merge, delete, colour.
 * `reparent` / `create` need a tree UI and stay out of this dialog.
 */

import { tagName, TAG_MAX_LENGTH, type TagCatalog } from './tag-catalog';

export type TagOp =
  | { op: 'rename'; from: string; to: string }
  | { op: 'merge'; from: string[]; to: string }
  | { op: 'delete'; tag: string }
  | { op: 'color'; tag: string; color: string | null };

/** Same palette the projects use; colour is presentation, not semantics. */
export const TAG_COLORS = [
  '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#64748b',
];

export const MAX_MERGE_SOURCES = 50;

const COLOR = /^#[0-9a-fA-F]{6}$/;

/** Client-side copy of the Hub rules, so obvious mistakes never become requests. */
export function validateTagOp(op: TagOp): string | null {
  if (op.op === 'color') {
    if (!tagName(op.tag)) return `标签名不合法：最多 ${TAG_MAX_LENGTH} 个字，不能含控制字符`;
    if (op.color !== null && !COLOR.test(op.color)) return '颜色格式不对，应为 #rrggbb';
    return null;
  }
  if (op.op === 'delete') {
    return tagName(op.tag) ? null : `标签名不合法：最多 ${TAG_MAX_LENGTH} 个字，不能含控制字符`;
  }
  if (op.op === 'rename') {
    if (!tagName(op.from) || !tagName(op.to)) return `标签名不合法：最多 ${TAG_MAX_LENGTH} 个字，不能含控制字符`;
    if (tagName(op.from) === tagName(op.to)) return '来源和目标相同，不用改';
    return null;
  }
  const sources = [...new Set(op.from.map(source => tagName(source)).filter((source): source is string => !!source))];
  if (sources.length === 0) return '至少选一个要合并的标签';
  if (sources.length > MAX_MERGE_SOURCES) return `一次最多合并 ${MAX_MERGE_SOURCES} 个标签`;
  const target = tagName(op.to);
  if (!target) return `目标标签名不合法：最多 ${TAG_MAX_LENGTH} 个字`;
  if (sources.length === 1 && sources[0] === target) return '来源和目标相同，不用合并';
  return null;
}

/** Hub error codes → what the dialog should tell the operator. */
export function tagOpMessage(status: number, error?: string | null): string {
  if (status === 401) return '登录已过期，请重新登录后再管理标签。';
  if (status === 403) {
    if (error === 'user_token_required') return '节点令牌不能管理标签，请用用户账号登录。';
    return '没有管理标签的权限：需要网络 owner、Hub 管理员，或任务范围为「全部任务」的成员。';
  }
  if (status === 404) return '这个标签在当前网络里已经不存在了，刷新后再试。';
  if (status === 400) {
    if (error === 'invalid_tag') return `标签名不合法：最多 ${TAG_MAX_LENGTH} 个字，不能含控制字符。`;
    if (error === 'invalid_tag_color') return '颜色格式不对，应为 #rrggbb。';
    if (error === 'same_tag') return '来源和目标相同，Hub 拒绝了这次操作。';
    if (error === 'invalid_tag_op') return '当前 Hub 不支持这个标签操作。';
    return 'Hub 拒绝了这次标签操作，标签未被修改。';
  }
  if (status === 409) return '这个标签已经存在。';
  return `标签操作失败（HTTP ${status || 0}），标签未被修改。`;
}

/**
 * Optimistic catalogue update used to repaint chips immediately; the dialog
 * still refetches afterwards, so this never becomes the source of truth.
 */
export function applyTagOpToCatalog(catalog: TagCatalog, op: TagOp): TagCatalog {
  const tags = [...catalog.tags];
  const counts = { ...catalog.counts };
  const colors = { ...catalog.colors };
  const nodes = catalog.nodes.map(node => ({ ...node }));

  const dropTag = (name: string) => {
    const index = tags.indexOf(name);
    if (index >= 0) tags.splice(index, 1);
    delete counts[name];
    delete colors[name];
  };
  const moveColor = (from: string, to: string) => {
    if (!colors[to] && colors[from]) colors[to] = colors[from];
    delete colors[from];
  };

  if (op.op === 'color') {
    if (op.color) colors[op.tag] = op.color.toLowerCase();
    else delete colors[op.tag];
    for (const node of nodes) if (node.name === op.tag) node.color = op.color ? op.color.toLowerCase() : null;
    return { ...catalog, tags, counts, colors, nodes };
  }
  if (op.op === 'delete') {
    dropTag(op.tag);
    for (const node of nodes) if (node.name === op.tag) node.color = null;
    return { ...catalog, tags: tags.filter(name => name !== op.tag), counts, colors, nodes };
  }
  if (op.op === 'rename') {
    const index = tags.indexOf(op.from);
    if (index >= 0) tags[index] = op.to;
    if (!tags.includes(op.to)) tags.push(op.to);
    if (counts[op.from] !== undefined) { counts[op.to] = (counts[op.to] ?? 0) + counts[op.from]; delete counts[op.from]; }
    moveColor(op.from, op.to);
    for (const node of nodes) {
      if (node.name === op.from) node.name = op.to;
      if (node.parent_id === op.from) node.parent_id = op.to;
    }
    return { ...catalog, tags: [...new Set(tags)], counts, colors, nodes };
  }
  const sources = op.from.filter(source => source !== op.to);
  for (const source of sources) {
    // Sum before dropping the source, otherwise its count is already gone.
    if (counts[op.to] !== undefined || counts[source] !== undefined) {
      counts[op.to] = (counts[op.to] ?? 0) + (counts[source] ?? 0);
    }
    dropTag(source);
    moveColor(source, op.to);
    for (const node of nodes) if (node.name === source) node.name = op.to;
  }
  if (!tags.includes(op.to)) tags.push(op.to);
  return { ...catalog, tags: [...new Set(tags)], counts, colors, nodes: dedupeNodes(nodes) };
}

function dedupeNodes(nodes: TagCatalog['nodes']): TagCatalog['nodes'] {
  const seen = new Set<string>();
  return nodes.filter(node => (seen.has(node.name) ? false : (seen.add(node.name), true)));
}
