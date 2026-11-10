'use client';

import { useEffect, type RefObject } from 'react';

/**
 * 模态框焦点管理（.462）。
 *
 * 背景：五个 Node* 面板此前只做了「Esc 关闭 + aria-labelledby」，
 * 没有把焦点移进面板，也没有关闭后还回去，Tab 还能跑到背后的页面上。
 * 键盘/读屏用户打开面板后，焦点仍在触发按钮上——看起来「什么都没发生」。
 *
 * 这里按 WAI-ARIA dialog 模式补三件事：
 *   ① 打开时把焦点移进面板（第一个可聚焦元素，没有就聚焦容器本身）
 *   ② Tab / Shift+Tab 在面板内循环，不跑到背后
 *   ③ 关闭时把焦点还给打开它的元素
 *
 * 不用第三方库：只需要这三条，自己写 40 行比引依赖更容易审。
 *
 * 判据（evidence/dialog-focus-probe.mjs）：
 *   打开后 document.activeElement 在面板内；
 *   连按 Tab N 次仍全部落在面板内；
 *   关闭后 activeElement 回到触发元素。
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus(ref: RefObject<HTMLElement | null>, fallbackSelector?: string) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 菜单项常常在关闭时一起卸载（例如 ⋮ 菜单里的「运行日志」），此时 opener 已不在文档里。
    // 退到「打开它的那个菜单按钮」（aria-haspopup 的祖先），比把焦点丢给 body 好得多。
    const fallback = (fallbackSelector
      ? document.querySelector<HTMLElement>(fallbackSelector)
      : opener?.closest<HTMLElement>('[aria-haspopup]')) ?? null;

    const focusables = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      // 隐藏元素（display:none / visibility:hidden）不参与循环，否则 Tab 会「消失」
      .filter((el) => el.offsetParent !== null || el === document.activeElement);

    // ① 初始焦点：优先第一个可聚焦元素；没有就让容器自己接（tabIndex=-1）
    const first = focusables()[0];
    if (first) first.focus();
    else {
      root.setAttribute('tabindex', '-1');
      root.focus();
    }

    // ② 焦点循环 + ③ Esc 之外的边界：只在 Tab 上做拦截，其它键一律不碰
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === firstEl || !root.contains(active))) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && (active === lastEl || !root.contains(active))) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKeyDown);

    return () => {
      root.removeEventListener('keydown', onKeyDown);
      // ③ 关闭后还给打开它的元素；它若已卸载**或不可见**（菜单已收起，元素还在 DOM 里但 offsetParent 为 null，
      // 此时 focus() 会静默失败、焦点落到 body），就退到菜单按钮。
      const canFocus = (el: HTMLElement | null): el is HTMLElement => !!el && document.contains(el) && el.offsetParent !== null;
      if (canFocus(opener)) opener.focus();
      else if (canFocus(fallback)) fallback.focus();
    };
  }, [ref]);
}
