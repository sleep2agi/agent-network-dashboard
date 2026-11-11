'use client';

import { useEffect } from 'react';

/**
 * 「小控件 = item 圆角」的渲染期打标（客户端 theme.ts 语义刻度）。
 *
 * 为什么不在 CSS 里做：客户端的规则是**按渲染高度**定义的 ——
 * 「高度 ≤32 的控件属 item（8px），其余控件属 control（12px）」。
 * CSS 选择器看不到自身高度，只能拿类名当线索；第二批实测四轮都不可收敛
 * （漏 rounded-md、把 30 个小控件推到 12、!important 被 (0,7,0) 特异性压过、
 * text-xs 误伤 44px 的分区标签）。所以这里直接量高度。
 *
 * 代价与约束：
 * - 只在挂载后跑一次 + MutationObserver 合并到 rAF，不做逐元素 ResizeObserver；
 * - 不监听 attributes，避免「打标 → 触发变更 → 再打标」的自激；
 * - 打出的只是 `data-radius-tier="item"`，真正的圆角值仍由 globals.css 决定。
 */
const SELECTOR = 'button, a, input:not([type="hidden"]), select, textarea, [role="button"]';
const ITEM_MAX_HEIGHT = 32;

function mark(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(SELECTOR))) {
    // SVG 图形不是控件（`.493`）：3D 军团里每个节点组是 `<g role="button">`，
    // 会被 `[role="button"]` 命中。但 `border-radius` 对 `<g>` 没有视觉效果，
    // 而 `.492` 现场实测：349 个 `<g>` 被误打标，其中 345 个变量与当前高度不符
    // （它们的"高度"是坐标缩放的结果，不是排版高度）。
    // ⇒ 既是无用功，又给"圆角分档"制造了 350 条假异常，必须排除。
    if (!(el instanceof HTMLElement)) continue;
    const h = el.getBoundingClientRect().height;
    // 隐藏元素（h=0）不参与：它们没有可判断的渲染高度，保持现状即可。
    if (h > 0 && h <= ITEM_MAX_HEIGHT) {
      // r/h 规则（设计师 2026-11-11）：tier 给上限 8px，r/h 给约束 r ≤ h/3
      //   h ≥ 24 → 8 · 18 ≤ h < 24 → 6 · h < 18 → 4
      const px = h >= 24 ? 8 : h >= 18 ? 6 : 4;
      if (el.dataset.radiusTier !== 'item') el.dataset.radiusTier = 'item';
      if (el.style.getPropertyValue('--item-radius') !== `${px}px`) {
        el.style.setProperty('--item-radius', `${px}px`);
      }
    } else if (el.dataset.radiusTier === 'item') {
      delete el.dataset.radiusTier;
      el.style.removeProperty('--item-radius');
    }
  }
}

export function useRadiusTier(): void {
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        mark();
      });
    };
    let disposed = false;
    const scheduleIfLive = () => {
      if (!disposed) schedule();
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule, { passive: true });
    // 值应随尺寸派生（`.493`）：字体会改变控件高度，而挂载时的量测早于字体就绪。
    // 不引入逐元素 ResizeObserver —— `.492` 现场实测 HTML 控件陈旧数为 0，
    // 先堵住两个已知触发点；若将来出现真实漂移再升级为观察器。
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.ready.then(scheduleIfLive).catch(() => {});
    }
    window.addEventListener('load', scheduleIfLive, { once: true });
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('load', scheduleIfLive);
    };
  }, []);
}
