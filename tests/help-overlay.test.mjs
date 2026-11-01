import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 帮助面板（`?`）的契约。
//
// 这张表是用户学习快捷键的唯一入口，却出过两种毛病：一是把内部轮次号
// `(R133)` 直接印给用户看；二是「Navigate」分组手写了一遍，加了军团/需求
// 之后没有同步。这里把两条都钉住：标签里不许出现内部轮次号，导航分组必须
// 由 GO_TARGETS 生成，且每个目标都得是真实存在的路由。

const root = join(import.meta.dir, '..');
const src = readFileSync(join(root, 'app/components/HelpOverlay.tsx'), 'utf8');

const labelLines = () => src.split('\n').filter((l) => l.includes('label:') && !l.includes('label: string'));
const targets = () => {
  const block = src.slice(src.indexOf('const GO_TARGETS'), src.indexOf('const SHORTCUTS'));
  return [...block.matchAll(/(\w): \{ href: '([^']+)', label: '([^']+)' \}/g)]
    .map((m) => ({ key: m[1], href: m[2], label: m[3] }));
};

describe('帮助面板', () => {
  test('标签里没有内部轮次号', () => {
    const leaked = labelLines().filter((l) => /\(R\d+/.test(l));
    expect(leaked).toEqual([]);
  });

  test('导航分组由 GO_TARGETS 生成（不手写副本）', () => {
    expect(src).toContain('Object.entries(GO_TARGETS)');
    // 手写的 g+字母 列表一旦回来，这条会红。
    const handwritten = [...src.matchAll(/\{ keys: \['g', '\w'\], label: /g)].length;
    expect(handwritten).toBe(0);
  });

  test('每个 g 目标都落在真实路由上', () => {
    const all = targets();
    expect(all.length).toBeGreaterThanOrEqual(10);
    const missing = all.filter((t) => {
      const dir = t.href === '/' ? 'app' : `app${t.href}`;
      return !existsSync(join(root, dir, 'page.tsx'));
    });
    expect(missing).toEqual([]);
  });

  test('大小写敏感：g l 去军团、Shift+L 才是日志', () => {
    expect(src).toContain('GO_TARGETS[e.key]');
    expect(src).not.toContain('GO_TARGETS[e.key.toLowerCase()]');
    const map = Object.fromEntries(targets().map((t) => [t.key, t.href]));
    expect(map.l).toBe('/legion');
    expect(map.L).toBe('/logs');
    expect(map.r).toBe('/requirements');
  });
});
