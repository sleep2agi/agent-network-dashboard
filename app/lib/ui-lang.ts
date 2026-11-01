'use client';

import { useSyncExternalStore } from 'react';

// Loop R18 (R3 i18n 还债, scoped): the WeChat-loop rounds introduced
// user-visible Chinese strings (pill, drafts, search, lightbox, retry).
// English-locale users saw mixed-language chrome. All call sites render
// only after client interaction/data (never in SSR HTML), so a plain
// navigator.language check is hydration-safe here.
export function isZh(): boolean {
  return typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
}

export function t(zh: string, en: string): string {
  return isZh() ? zh : en;
}

/**
 * 水合安全的语言判定。
 *
 * bug（#182）：`t()` 直接读 `navigator.language`。服务端没有 navigator →
 * 渲染英文；中文浏览器首帧 → 渲染中文。同一棵树两边文本不同，React 报
 * #418 并把整棵子树丢掉重渲染（/nodes 上实测："Hide node list" vs
 * "隐藏节点列表"）。
 *
 * 这里让**首帧永远与服务端一致**（false = 英文），挂载后再切到真实语言。
 * 代价是中文用户会看到一次英文标签的闪动——只有在真的进了 SSR HTML 的
 * 文案上才会看到；比丢掉整棵服务端树、控制台常年报错温和得多。
 *
 * 需要水合安全的组件：在组件函数体里写 `const t = useT();` 即可，调用点
 * 不用改（局部变量遮蔽模块级的 t）。
 */
const noopSubscribe = () => () => {};

export function useIsZh(): boolean {
  // useSyncExternalStore 就是为这件事准备的：服务端快照固定 false（英文），
  // 水合时先用服务端快照、水合完再切到浏览器语言 —— 不会触发同步 setState。
  return useSyncExternalStore(noopSubscribe, isZh, () => false);
}

export function useT(): (zh: string, en: string) => string {
  const zh = useIsZh();
  return (zhText: string, enText: string) => (zh ? zhText : enText);
}
