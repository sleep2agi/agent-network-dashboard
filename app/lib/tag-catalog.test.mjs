import { describe, expect, test } from 'bun:test';
import {
  catalogFromHub, editorTagSuggestions, orderedTags, tagColor, tagCount, tagName, tagSuggestions,
  tagTreeRows, tagParentOptions, tagDescendants,
} from './tag-catalog';

describe('tag catalogue (read side of Hub /api/requirements/tags)', () => {
  test('old Hub: tags only, nothing to colour or manage', () => {
    const catalog = catalogFromHub({ ok: true, tags: ['UI', '交互'] });
    expect(catalog?.tags).toEqual(['UI', '交互']);
    expect(catalog?.counts).toEqual({});
    expect(catalog?.colors).toEqual({});
    expect(catalog?.nodes).toEqual([]);
    expect(catalog?.canManage).toBe(false);
    expect(tagColor(catalog, 'UI')).toBeNull();
    expect(tagCount(catalog, 'UI')).toBeNull();
  });

  test('garbage or failed bodies yield null so the UI keeps plain tags', () => {
    expect(catalogFromHub(null)).toBeNull();
    expect(catalogFromHub({ ok: false })).toBeNull();
    expect(catalogFromHub({ ok: true })).toBeNull();
    expect(catalogFromHub({ ok: true, tags: [] })).toBeNull();
  });

  test('counts and colours are validated; nodes keep tree data and colour', () => {
    const catalog = catalogFromHub({
      ok: true,
      tags: ['ANet', 'UI', '交互', ''],
      counts: { ANet: 1142, UI: 4, 交互: -1, bad: 'x' },
      colors: { ANet: '#DC2626', UI: 'red' },
      can_manage: true,
      nodes: [
        { name: 'ANet', parent_id: null, depth: 1, registered: true, count: 1142, color: '#dc2626' },
        { name: 'ANet插件', parent_id: 'ANet', depth: 2, registered: true, count: 21, color: null },
        { name: 'bad', parent_id: null, depth: 1, registered: false, count: 1, color: 'not-a-colour' },
      ],
    });
    expect(catalog?.tags).toEqual(['ANet', 'UI', '交互']);
    expect(catalog?.counts).toEqual({ ANet: 1142, UI: 4 });
    expect(catalog?.colors).toEqual({ ANet: '#dc2626' });
    expect(catalog?.canManage).toBe(true);
    expect(catalog?.nodes.map(node => node.name)).toEqual(['ANet', 'ANet插件']);
    expect(tagColor(catalog, 'ANet插件')).toBeNull();
    expect(tagColor(catalog, 'anet')).toBeNull(); // colours are keyed by exact tag name
    expect(catalog?.nodes[1].parent_id).toBe('ANet');
  });

  test('a colour known only on the tree node still paints the chip', () => {
    const catalog = catalogFromHub({
      ok: true,
      tags: ['TM知识库'],
      nodes: [{ name: 'TM知识库', parent_id: null, depth: 1, registered: true, count: 393, color: '#16A34A' }],
    });
    expect(tagColor(catalog, 'TM知识库')).toBe('#16a34a');
    expect(tagCount(catalog, 'TM知识库')).toBe(393);
  });

  test('tag names follow Hub rules: trimmed, ≤20 chars, no control characters', () => {
    expect(tagName('  UI ')).toBe('UI');
    expect(tagName('   ')).toBeNull();
    expect(tagName('x'.repeat(21))).toBeNull();
    expect(tagName('a\nb')).toBeNull();
    expect(tagName('😀'.repeat(20))).not.toBeNull();
  });

  test('pickers order by usage, then name', () => {
    const catalog = catalogFromHub({ ok: true, tags: ['z', 'a', 'b'], counts: { z: 2, a: 2, b: 9 } });
    expect(orderedTags(catalog).map(row => row.name)).toEqual(['b', 'a', 'z']);
  });

  test('suggestions: exact, then prefix, then substring, applied tags excluded', () => {
    const catalog = catalogFromHub({
      ok: true,
      tags: ['UI', 'UI 走查', '交互', 'bug', 'Build'],
      counts: { UI: 4, 'UI 走查': 1, 交互: 2, bug: 9, Build: 3 },
    });
    expect(tagSuggestions(catalog, '', ['bug'], 3).map(row => row.name)).toEqual(['UI', 'Build', '交互']);
    expect(tagSuggestions(catalog, 'u', [], 4).map(row => row.name)).toEqual(['UI', 'UI 走查', 'bug', 'Build']);
    expect(tagSuggestions(catalog, 'ui')[0].name).toBe('UI');
    expect(tagSuggestions(catalog, 'zzz')).toEqual([]);
    expect(tagSuggestions(null, 'ui')).toEqual([]);
  });

  test('editor suggestions exclude tags already in the comma separated draft', () => {
    const catalog = catalogFromHub({ ok: true, tags: ['p', 'q', 'r'], counts: { p: 3, q: 2, r: 1 } });
    expect(editorTagSuggestions(catalog, 'q,  新').map(row => row.name)).toEqual(['p', 'r']);
    expect(editorTagSuggestions(catalog, 'q，r').map(row => row.name)).toEqual(['p']);
  });
});

describe('tag tree helpers', () => {
  const catalog = catalogFromHub({
    ok: true,
    tags: ['需求', '前端', '构建', '独立'],
    counts: { 需求: 10, 前端: 6, 构建: 2, 独立: 3 },
    nodes: [
      { name: '需求', parent_id: null, depth: 1, registered: true, count: 10 },
      { name: '前端', parent_id: '需求', depth: 2, registered: true, count: 6 },
      { name: '构建', parent_id: '前端', depth: 3, registered: true, count: 2 },
    ],
  });

  test('tree rows put children under their parent with depth', () => {
    const flat = tagTreeRows(catalog).map(row => [row.name, row.depth]);
    expect(flat).toEqual([['需求', 1], ['前端', 2], ['构建', 3], ['独立', 1]]);
  });

  test('descendants and parent options prevent cycles and depth overflow', () => {
    expect([...tagDescendants(catalog, '需求')].sort()).toEqual(['前端', '构建', '需求']);
    const options = tagParentOptions(catalog, '需求').map(row => row.name);
    expect(options).not.toContain('前端');
    expect(options).not.toContain('构建');
    expect(options).toContain('独立');
    // 构建 is depth 3: it may be a parent, its children would be depth 4 (allowed).
    expect(tagParentOptions(catalog).map(row => row.name)).toContain('前端');
    expect(tagTreeRows(catalog).length).toBe(4);
  });

  test('a cycle in Hub data still shows every tag once', () => {
    const cyc = catalogFromHub({
      ok: true,
      tags: ['a', 'b'],
      nodes: [
        { name: 'a', parent_id: 'b', depth: 2, registered: true, count: 1 },
        { name: 'b', parent_id: 'a', depth: 2, registered: true, count: 1 },
      ],
    });
    expect(tagTreeRows(cyc).map(row => row.name).sort()).toEqual(['a', 'b']);
  });
});
