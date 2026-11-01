import { describe, expect, test } from 'bun:test';
import { shouldRestoreFocus } from './focus-fallback.ts';

// 判定只有一条：焦点「真的丢了」才接管。写宽了会把用户挪走的焦点抢回来，
// 写窄了会出现「按钮消失后焦点留在 body」——两种都是实际踩过的。
describe('焦点兜底判定', () => {
  const body = { tag: 'BODY' };
  const field = { tag: 'INPUT' };

  test('焦点在 body → 需要接管', () => {
    expect(shouldRestoreFocus(body, body)).toBe(true);
  });

  test('完全没有焦点 → 需要接管', () => {
    expect(shouldRestoreFocus(null, body)).toBe(true);
  });

  test('焦点在别的控件上 → 不抢', () => {
    expect(shouldRestoreFocus(field, body)).toBe(false);
  });

  test('拿不到 body 引用时不乱抢（只有「完全没焦点」才接管）', () => {
    // body 为空就无法证明焦点丢在 body → 保守放行，不去抢用户可能已经挪走的焦点。
    expect(shouldRestoreFocus(body, null)).toBe(false);
    expect(shouldRestoreFocus(null, null)).toBe(true);
  });
});
