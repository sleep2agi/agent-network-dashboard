import { useEffect, useRef } from 'react';

/**
 * 控件卸载后的焦点兜底。
 *
 * 为什么单独一个模块：这个模式已经手写过两次（需求列表的「加载更多」、详情页的
 * 「更早的评论」），两处都是「点完以后按钮消失 → 焦点掉到 body → 键盘用户凭空
 * 消失」。写两遍就一定会分叉：一处修了、另一处没修。抽出来以后，判定只有一份。
 *
 * 只在「焦点确实是丢的」时候接管——如果用户已经把焦点挪到别处（比如用键盘
 * 跳到了别的控件），这里不该把人拽回来。
 */

/** 焦点是否丢在了 body（或干脆没有焦点）。纯函数，便于单测。
 *  拿不到 body 引用时无法证明「丢在 body」，保守放行——宁可少接管一次，
 *  也不要把用户已经挪到别的控件上的焦点抢回来。 */
export function shouldRestoreFocus(active: Element | null, body: Element | null): boolean {
  return !active || active === body;
}

/**
 * 在下一帧把焦点交给 fallback，仅当此刻焦点已丢。
 *
 * @param getTarget 返回兜底目标（通常是列表/区块容器，带 tabIndex={-1}）
 */
export function restoreFocusAfterUnmount(getTarget: () => HTMLElement | null): void {
  if (typeof window === 'undefined') return;
  requestAnimationFrame(() => {
    const el = getTarget();
    if (!el) return;
    if (!shouldRestoreFocus(document.activeElement, document.body)) return;
    el.focus({ preventScroll: true });
  });
}

/**
 * busy 期间的焦点保护（hook）。
 *
 * 为什么需要：`disabled={busy}` 是这里最常见写法，而**禁用会让焦点回到 body**。
 * 批量操作这类按钮在请求期间被禁用、请求后仍留在原处，用户本该继续停在这个
 * 按钮上——否则连点两次批量操作就得重新 Tab 一大圈。
 *
 * 语义仍然是「只在焦点确实丢了时才接管」，用户中途把焦点挪走就不抢。
 */
export function useRestoreFocusAfterBusy(busy: boolean): void {
  // 必须用 focusin 持续记录「最后一个拿到焦点的元素」：等 busy 变成 true 的 effect
  // 里再读 activeElement 已经晚了——元素被 disabled 的那一刻浏览器就把它 blur 了，
  // 那时读到的只会是 body（实测：焦点确实掉到 body，恢复没生效）。
  const lastFocused = useRef<Element | null>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    const onFocusIn = () => { lastFocused.current = document.activeElement; };
    window.addEventListener('focusin', onFocusIn, true);
    return () => window.removeEventListener('focusin', onFocusIn, true);
  }, []);
  useEffect(() => {
    if (!busy && wasBusy.current) {
      const target = lastFocused.current;
      if (shouldRestoreFocus(document.activeElement, document.body)
        && target instanceof HTMLElement && target.isConnected
        && !(target as HTMLButtonElement).disabled
        && !(target as HTMLSelectElement).disabled) {
        target.focus({ preventScroll: true });
      }
    }
    wasBusy.current = busy;
  }, [busy]);
}
