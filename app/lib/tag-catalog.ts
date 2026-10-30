/**
 * Tag catalogue — mirrors the APP's `task-tag-catalog` read side.
 *
 * Hub (`GET /api/requirements/tags`) returns the tags in use plus optional
 * `counts`, `colors`, `can_manage` and a `nodes` tree. Old Hubs only return
 * `tags`, so every helper here must work with that degenerate shape: no
 * counts, no colours, no tree, nothing to manage.
 */

export interface TagNode {
  name: string;
  parent_id: string | null;
  depth: number;
  registered: boolean;
  count: number;
  color?: string | null;
}

export interface TagCatalog {
  tags: string[];
  counts: Record<string, number>;
  colors: Record<string, string>;
  nodes: TagNode[];
  /** Hub said this caller may rename/merge/delete/recolour. Not used yet. */
  canManage: boolean;
}

export interface TagSuggestion {
  name: string;
  count: number;
  color: string | null;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
export const TAG_MAX_LENGTH = 20;

export function catalogFromHub(data: unknown): TagCatalog | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as Record<string, unknown>;
  if (body.ok === false) return null;
  if (!Array.isArray(body.tags)) return null;
  const tags = body.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '');

  const counts: Record<string, number> = {};
  if (body.counts && typeof body.counts === 'object' && !Array.isArray(body.counts)) {
    for (const [name, value] of Object.entries(body.counts as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) counts[name] = value;
    }
  }

  const colors: Record<string, string> = {};
  if (body.colors && typeof body.colors === 'object' && !Array.isArray(body.colors)) {
    for (const [name, value] of Object.entries(body.colors as Record<string, unknown>)) {
      if (typeof value === 'string' && COLOR.test(value)) colors[name] = value.toLowerCase();
    }
  }

  const nodes: TagNode[] = [];
  if (Array.isArray(body.nodes)) {
    for (const item of body.nodes) {
      if (!item || typeof item !== 'object') continue;
      const node = item as Record<string, unknown>;
      if (typeof node.name !== 'string' || !node.name.trim()) continue;
      if (explicitColor(node.color) === undefined) continue;
      nodes.push({
        name: node.name,
        parent_id: typeof node.parent_id === 'string' && node.parent_id ? node.parent_id : null,
        depth: typeof node.depth === 'number' && node.depth >= 1 ? node.depth : 1,
        registered: node.registered === true,
        count: typeof node.count === 'number' && node.count >= 0 ? node.count : 0,
        color: explicitColor(node.color),
      });
    }
  }

  if (tags.length === 0 && nodes.length === 0) return null;
  return { tags, counts, colors, nodes, canManage: body.can_manage === true };
}

/** Valid tag name per Hub rules: trimmed, 1–20 characters, no control chars. */
export function tagName(input: string): string | null {
  const name = (input || '').trim();
  // Count code points, like the Hub: 20 emoji are one short tag, not 40.
  if (!name || [...name].length > TAG_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

function explicitColor(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && COLOR.test(value)) return value.toLowerCase();
  return undefined; // malformed: skip the node rather than guessing
}

export function tagColor(catalog: TagCatalog | null, tag: string): string | null {
  if (!catalog) return null;
  const direct = catalog.colors[tag];
  if (direct) return direct;
  const node = catalog.nodes.find(item => item.name === tag);
  return node?.color ?? null;
}

export function tagCount(catalog: TagCatalog | null, tag: string): number | null {
  if (!catalog) return null;
  const count = catalog.counts[tag];
  if (typeof count === 'number') return count;
  const node = catalog.nodes.find(item => item.name === tag);
  return node ? node.count : null;
}

/** Catalogue order for pickers: most used first, then by name. */
export function orderedTags(catalog: TagCatalog | null): TagSuggestion[] {
  if (!catalog) return [];
  const seen = new Set<string>();
  const rows: TagSuggestion[] = [];
  const names = [...catalog.tags, ...catalog.nodes.map(node => node.name)];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    rows.push({ name, count: tagCount(catalog, name) ?? 0, color: tagColor(catalog, name) });
  }
  return rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/**
 * Suggestions for the tag box: exact match, then prefix matches, then any
 * substring — each group by usage. Currently applied tags are excluded so the
 * list never offers a filter that is already on.
 */
export function tagSuggestions(
  catalog: TagCatalog | null,
  query: string,
  exclude: readonly string[] = [],
  limit = 8,
): TagSuggestion[] {
  if (!catalog) return [];
  const q = (query || '').trim().toLowerCase();
  const skip = new Set(exclude);
  const all = orderedTags(catalog).filter(row => !skip.has(row.name));
  if (!q) return all.slice(0, limit);
  const exact = all.filter(row => row.name.toLowerCase() === q);
  const prefix = all.filter(row => row.name.toLowerCase().startsWith(q) && row.name.toLowerCase() !== q);
  const rest = all.filter(row => {
    const name = row.name.toLowerCase();
    return name !== q && !name.startsWith(q) && name.includes(q);
  });
  return [...exact, ...prefix, ...rest].slice(0, limit);
}

/** Tags already on the row plus the ones being typed, for the editor chips. */
export function editorTagSuggestions(catalog: TagCatalog | null, draft: string, limit = 10): TagSuggestion[] {
  const current = new Set(
    draft.split(/[,，]/).map(part => part.trim()).filter(Boolean),
  );
  return orderedTags(catalog).filter(row => !current.has(row.name)).slice(0, limit);
}
