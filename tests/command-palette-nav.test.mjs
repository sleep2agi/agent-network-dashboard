import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 命令面板「导航」契约。
//
// 侧栏注释里写着「低频页仍可通过 ⌘K 到达」，那就必须真的到得了。这条测试
// 把两个来源钉在一起：Sidebar 的 NAV_ITEMS 里每一个 href，CommandPalette 都
// 得有一条 `r.push('<href>')`；漏一个就会有人以为某个页「没了」。
//
// 3D 军团页不在侧栏里（它是 2D 的子视图），单独断言，免得它又被漏掉。

const root = join(import.meta.dir, '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const sidebarHrefs = () => {
  const src = read('app/components/Sidebar.tsx');
  const block = src.slice(src.indexOf('const NAV_ITEMS'), src.indexOf('interface SidebarNetwork'));
  return [...block.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
};

describe('命令面板导航覆盖', () => {
  test('侧栏每个入口都能在 ⌘K 里搜到', () => {
    const palette = read('app/components/CommandPalette.tsx');
    const missing = sidebarHrefs().filter((href) => !palette.includes(`r.push('${href}')`));
    expect(missing).toEqual([]);
  });

  test('3D 军团也有入口（子视图不在侧栏里）', () => {
    expect(read('app/components/CommandPalette.tsx')).toContain("r.push('/legion/3d')");
  });

  test('导航项分组统一，不漏 group', () => {
    const palette = read('app/components/CommandPalette.tsx');
    const rows = [...palette.matchAll(/id: '(go-[a-z0-9-]+)'[\s\S]{0,320}?perform:/g)];
    // 至少覆盖侧栏入口数 + 3D
    expect(rows.length).toBeGreaterThanOrEqual(sidebarHrefs().length + 1);
    const ungrouped = rows.filter((r) => !/group: 'Navigate'/.test(r[0]));
    expect(ungrouped.map((r) => r[1])).toEqual([]);
  });
});
