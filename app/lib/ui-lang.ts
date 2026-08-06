'use client';

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
