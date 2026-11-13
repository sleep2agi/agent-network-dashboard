'use client';

/**
 * `.542`：首屏 chrome 请求的可开关延后（实验用，默认关闭）。
 *
 * 背景：线上 /legion 首屏一次触发 8–10 个 /api/hub/* 请求，上游 Hub 串行处理，
 *       单接口 0.22s 被放大到 1.6–1.8s；首屏必须等 people + departments ⇒ 3.8–7.2s。
 *
 * 设计：默认行为完全不变（未带 `?deferChrome=1` 时延迟为 0）；
 *       只有显式带参数时才把"非首屏必需"的 chrome 请求（概览 / 任务统计）延后 1.5s，
 *       用来在线测量"减少并发是否真的让首屏变快"。验证有效后再决定是否把默认打开。
 *
 * 实现注意（`.542` 教训）：
 *   · 不用 useMemo/useState + 同步 setState 读 URL —— 会触发 react-hooks/set-state-in-effect
 *   · 改成模块级惰性读取（首个调用时算一次），避免 effect 内 setState
 */
import { useEffect, useState } from 'react';

let cachedDeferMs: number | null = null;

/** 读取 ?deferChrome=1（只算一次；服务端返回 0） */
export function chromeDeferMs(): number {
  if (cachedDeferMs !== null) return cachedDeferMs;
  if (typeof window === 'undefined') return 0;
  try {
    const on = new URLSearchParams(window.location.search).get('deferChrome') === '1';
    cachedDeferMs = on ? 1500 : 0;
  } catch {
    cachedDeferMs = 0;
  }
  return cachedDeferMs;
}

/**
 * ms=0 时立即返回 key（默认路径，无任何额外渲染）；
 * ms>0 时在 setTimeout 里放行（异步 setState，符合 hooks 规则）。
 */
export function useDeferredKey<T>(key: T, ms: number): T | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ms === 0) return;
    const t = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  if (ms === 0) return key;
  return ready ? key : null;
}
