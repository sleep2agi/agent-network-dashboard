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
