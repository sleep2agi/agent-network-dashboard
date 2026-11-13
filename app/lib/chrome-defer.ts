'use client';

/**
 * `.542`：首屏 chrome 请求的可开关延后（实验用，默认关闭）。
 *
 * 背景：线上 /legion 首屏一次触发 8–10 个 /api/hub/* 请求，上游 Hub 串行处理，
 *       单接口 0.22s 被放大到 1.6–1.8s；首屏必须等 people + departments ⇒ 3.8–7.2s。
 *
 * 设计：默认行为完全不变（未带 `?deferChrome=1` 时延迟为 0）；
 *       只有显式带参数时才把"非首屏必需"的 chrome 请求（消息角标 / 概览 / 任务统计）
 *       延后 1.5s，用来在线测量"减少并发是否真的让首屏变快"。
 *       验证有效后再决定是否把默认打开（一行改动）。
 */
import { useEffect, useState } from 'react';

export function useChromeDeferMs(): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('deferChrome');
      if (q === '1') setMs(1500);
    } catch { /* 忽略 */ }
  }, []);
  return ms;
}

export function useDeferredKey<T>(key: T, ms: number): T | null {
  const [ok, setOk] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) { setOk(true); return; }
    setOk(false);
    const t = setTimeout(() => setOk(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return ok ? key : null;
}
