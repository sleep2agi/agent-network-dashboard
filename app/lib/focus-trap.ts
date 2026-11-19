/**
 * 模态弹窗的焦点容纳（focus containment）
 *
 * 为什么需要：`role="dialog" aria-modal="true"` 是对读屏的承诺 —— 模态期内
 * 不应再与背后内容交互。实测（`.628` 前，`evidence/probes/legion-help-focus-trap.mjs`）
 * 军团 2D 页的帮助弹窗按 Tab 8 次全部逃到背后导航（`BUTTON[network-switcher]`、
 * `A:节点`、`A:军团`），3D 页只在焦点恰好位于舞台子树内时才靠舞台的
 * `onKeyDown` 兜住，一旦焦点在别处同样逃逸。视觉焦点环被 70% 遮罩挡住，
 * 用户看不见自己按到了什么，再按回车就会误触背后的操作。
 *
 * 做法：弹窗打开时记住原焦点、把焦点送进弹窗，并在 `document` 捕获阶段
 * 拦住 Tab / Shift+Tab 做循环；关闭时把焦点还给原处（元素已移除则用兜底元素）。
 *
 * 边界：只在 `open` 为真时生效；不做 `inert`/`aria-hidden` 的整页屏蔽
 * （那会影响本项目的共享 SSE 与画布渲染），只保证键盘走不出弹窗。
 */
import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 循环取下一个焦点下标；`current < 0` 表示焦点不在弹窗内（从头/尾进入） */
export function trapIndex(count: number, current: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  const next = shift ? current - 1 : current + 1;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}

/** 可见且可聚焦的元素（`getClientRects()` 过滤掉 display:none / 折叠容器里的项） */
export function focusablesIn(node: HTMLElement | null): HTMLElement[] {
  if (!node) return [];
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0 && el.getAttribute('aria-hidden') !== 'true',
  );
}

export function useFocusTrap(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  fallbackRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 打开即入内：首选第一个可聚焦元素；没有就把焦点放在容器本身。
    (focusablesIn(node)[0] ?? node).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusablesIn(node);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const current = active ? items.indexOf(active) : -1;
      const target = trapIndex(items.length, current, e.shiftKey);
      e.preventDefault();
      if (target >= 0) items[target].focus();
      else node.focus();
    };

    // 捕获阶段挂在 document 上：即使焦点已经跑到弹窗之外，下一次 Tab 也会被拉回循环内。
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected && previous.getClientRects().length) previous.focus();
      else fallbackRef?.current?.focus();
    };
  }, [open, containerRef, fallbackRef]);
}
