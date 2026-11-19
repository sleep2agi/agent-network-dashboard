import { describe, expect, test } from 'bun:test';
import { trapIndex } from './focus-trap.ts';

// 弹窗只有 1–2 个可聚焦元素是常态（3D 帮助表里只有一个关闭按钮），
// 循环必须能把 Tab / Shift+Tab 都兜在容器内 —— 这是 aria-modal="true" 的实现前提。
describe('模态弹窗焦点循环', () => {
  test('单个元素：前进与后退都停在原地', () => {
    expect(trapIndex(1, 0, false)).toBe(0);
    expect(trapIndex(1, 0, true)).toBe(0);
  });

  test('多个元素：尾→首、首→尾', () => {
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
  });

  test('焦点不在容器内：前进从首、后退从尾', () => {
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
  });

  test('没有可聚焦元素：返回 -1，交由容器自身接住', () => {
    expect(trapIndex(0, -1, false)).toBe(-1);
  });

  test('中间位置照常前后移动', () => {
    expect(trapIndex(4, 1, false)).toBe(2);
    expect(trapIndex(4, 2, true)).toBe(1);
  });
});
