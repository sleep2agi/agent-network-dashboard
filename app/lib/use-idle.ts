'use client';

import { useEffect, useState } from 'react';

/** 首屏「让路」开关：真正的首屏内容（节点列表）先跑，次要请求等浏览器空闲。
 *
 * 依据（2026-11-09 实测）：/nodes 首屏同时发出约 11 个请求，浏览器对同源
 * HTTP/1.1 只开 6 条连接，于是 `/api/hub/status?lite=1` 明明 curl 只要 0.5–1.0s，
 * 在页面里却要 3950ms —— 不是接口慢，是排队 + 主线程争用。
 * 把「未读角标 / 失败任务横幅」这类次要数据挪到 idle 之后，首屏只留
 * status(lite) + nodes(lite) + overview 三条关键路径。
 *
 * 注意：这不是「不请求」，只是推迟到首帧之后；SSR 阶段不触发。
 */
export function useIdle(timeoutMs = 1500): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: timeoutMs });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setIdle(true), 200);
    return () => window.clearTimeout(t);
  }, [timeoutMs]);
  return idle;
}

/** 军团页面数据门：`/legion*` 路由上，未读角标那条 200 条 messages 请求
 *  必须等该页编制就绪（或 3s 兜底）之后再发。
 *
 * 依据（2026-11-14，线上 1440×5 次中位数，`evidence/probes/legion-phase-timing.mjs`）：
 *   · 基线：`/api/hub/people` 1404ms、编制就绪 4296ms
 *   · 掐掉 messages：people **722ms**、编制就绪 **3477ms**（-49% / -19%）
 *   · 掐掉 overview：people 1284ms、编制就绪 3840ms（几乎无收益）
 * ⇒ 与首屏关键路径抢 Hub 的是 messages，不是 overview；而 useIdle() 只看主线程空闲，
 *   数据还在飞的时候主线程就已经空闲了，所以这条请求很早就发出去了。
 * ⇒ 这里加一道"该页数据就绪"的门，把 messages 排到 people 之后；角标最多晚 3s。
 */
export function useLegionGate(fallbackMs = 3000): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // 注意：这里不能同步 setState（React 编译器 lint 规则会报
    // "Calling setState synchronously within an effect can trigger cascading renders"）。
    // 不用门的情况也用 0ms 定时器放行，保持"永远异步"这一条不变的形状。
    const isLegion3d = window.location.pathname.startsWith('/legion/3d');
    const readyNow = document.documentElement.dataset.legionDataReady === '1';
    if (!isLegion3d || readyNow) {
      const t = window.setTimeout(() => setOpen(true), 0);
      return () => window.clearTimeout(t);
    }
    const timer = window.setTimeout(() => setOpen(true), fallbackMs);
    const poll = window.setInterval(() => {
      if (document.documentElement.dataset.legionDataReady === '1') {
        window.clearInterval(poll);
        window.clearTimeout(timer);
        setOpen(true);
      }
    }, 100);
    return () => { window.clearInterval(poll); window.clearTimeout(timer); };
  }, [fallbackMs]);
  return open;
}
