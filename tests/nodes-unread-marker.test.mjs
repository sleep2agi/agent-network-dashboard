import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 节点列表的未读标记：一个事实只能有一个标记。
//
// 之前一张卡上同时有：数字角标、一个位置几乎重合的纯红点、以及一个 "New"
// 胶囊——同一件事说三遍，前两个还会互相压住。数字最有用，所以留数字；
// 静音会话不显示数字（不然等于催人去读一个他明确静音了的会话），
// 那时才用 "New" 这个词兜底。

const root = join(import.meta.dir, '..');
const src = readFileSync(join(root, 'app/nodes/NodesView.tsx'), 'utf8');

describe('节点列表未读标记', () => {
  test('没有「纯红点 + 数字」重复标记', () => {
    // 纯红点长这样：unread && <span ... bg-red-500" /> 且不带计数文案。
    const bareDots = src.split('\n').filter((l) => l.includes('{unread && <span') && l.includes('bg-red-500') && !l.includes('aria-label'));
    expect(bareDots).toEqual([]);
  });

  test('数字角标仍然在（每处未读计数一个）', () => {
    const counters = src.split('\n').filter((l) => l.includes('条未读'));
    expect(counters.length).toBeGreaterThanOrEqual(3); // avatar(36px) / row(20px) / 紧凑变体
  });

  test('"New" 只在静音时出现（数字已经说了几条）', () => {
    const pills = src.split('\n').filter((l) => l.includes('New</span>'));
    expect(pills.length).toBeGreaterThan(0);
    for (const line of pills) expect(line).toContain('isMuted(');
  });
});
