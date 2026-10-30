import { describe, expect, test } from 'bun:test';
import { applyTagOpToCatalog, tagOpMessage, validateTagOp, TAG_COLORS, MAX_MERGE_SOURCES } from './tag-ops';
import { catalogFromHub, tagColor, tagCount } from './tag-catalog';

const catalog = catalogFromHub({
  ok: true,
  tags: ['ANet', 'UI', '无颜色'],
  counts: { ANet: 9, UI: 4, 无颜色: 2 },
  colors: { ANet: '#dc2626' },
  can_manage: true,
});
if (!catalog) throw new Error('fixture catalogue');

describe('tag management (Hub tags/ops)', () => {
  test('client validation mirrors Hub name rules before any request', () => {
    expect(validateTagOp({ op: 'rename', from: 'UI', to: '界面' })).toBeNull();
    expect(validateTagOp({ op: 'rename', from: 'UI', to: 'UI' })).toContain('相同');
    expect(validateTagOp({ op: 'rename', from: 'UI', to: 'x'.repeat(21) })).toContain('不合法');
    expect(validateTagOp({ op: 'rename', from: 'UI', to: 'a\nb' })).toContain('不合法');
    expect(validateTagOp({ op: 'delete', tag: '  ' })).toContain('不合法');
    expect(validateTagOp({ op: 'merge', from: [], to: 'ANet' })).toContain('至少');
    expect(validateTagOp({ op: 'merge', from: ['UI'], to: 'UI' })).toContain('相同');
    expect(validateTagOp({ op: 'merge', from: Array.from({ length: MAX_MERGE_SOURCES + 1 }, (_, i) => `t${i}`), to: 'ANet' })).toContain('最多');
    expect(validateTagOp({ op: 'color', tag: 'UI', color: 'red' })).toContain('#rrggbb');
    expect(validateTagOp({ op: 'color', tag: 'UI', color: null })).toBeNull();
    expect(TAG_COLORS.every(color => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  });

  test('Hub errors become operator-facing sentences', () => {
    expect(tagOpMessage(403)).toContain('权限');
    expect(tagOpMessage(403, 'user_token_required')).toContain('节点令牌');
    expect(tagOpMessage(404)).toContain('不存在');
    expect(tagOpMessage(400, 'invalid_tag')).toContain('标签名');
    expect(tagOpMessage(400, 'invalid_tag_color')).toContain('#rrggbb');
    expect(tagOpMessage(400, 'same_tag')).toContain('相同');
    expect(tagOpMessage(400, 'invalid_tag_op')).toContain('不支持');
    expect(tagOpMessage(500)).toContain('HTTP 500');
  });

  test('optimistic catalogue: rename keeps position and colour', () => {
    const next = applyTagOpToCatalog(catalog, { op: 'rename', from: 'ANet', to: 'ANet2' });
    expect(next.tags).toEqual(['ANet2', 'UI', '无颜色']);
    expect(tagColor(next, 'ANet2')).toBe('#dc2626');
    expect(tagCount(next, 'ANet2')).toBe(9);
    expect(next.tags).not.toContain('ANet');
  });

  test('optimistic catalogue: merge sums counts and keeps the target colour', () => {
    const next = applyTagOpToCatalog(catalog, { op: 'merge', from: ['无颜色', 'UI'], to: 'ANet' });
    expect(next.tags).toEqual(['ANet']);
    expect(tagCount(next, 'ANet')).toBe(15);
    expect(tagColor(next, 'ANet')).toBe('#dc2626');
  });

  test('optimistic catalogue: delete and colour', () => {
    const deleted = applyTagOpToCatalog(catalog, { op: 'delete', tag: 'UI' });
    expect(deleted.tags).toEqual(['ANet', '无颜色']);
    expect(tagCount(deleted, 'UI')).toBeNull();
    const coloured = applyTagOpToCatalog(catalog, { op: 'color', tag: 'UI', color: '#2563EB' });
    expect(tagColor(coloured, 'UI')).toBe('#2563eb');
    const cleared = applyTagOpToCatalog(coloured, { op: 'color', tag: 'UI', color: null });
    expect(tagColor(cleared, 'UI')).toBeNull();
  });
});
