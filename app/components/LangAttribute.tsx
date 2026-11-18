'use client';

import { useEffect } from 'react';

/**
 * `.613`：把 <html lang> 按浏览器语言改成 zh-CN / en。
 *
 * 为什么改：layout 里 lang 是硬编码 "en"，但这个产品界面以中文为主。
 * 影响两件事：
 *   ① 读屏器会用英文语音读中文内容（可访问性问题）
 *   ② 浏览器的"是否翻译此页"提示、CJK 字体回退选择都会按英文处理
 *
 * 为什么不在服务端按语言渲染 lang：服务端没有 navigator（见 lib/ui-lang.ts 的 #182 注释），
 * 按语言渲染会让首帧 HTML 与客户端不一致，触发 #418 丢树。
 * 这里保持 SSR 输出 lang="en"，挂载后再改 —— 属性变更不参与 hydration 比对。
 */
export function LangAttribute() {
  useEffect(() => {
    const zh = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('zh');
    const next = zh ? 'zh-CN' : 'en';
    if (document.documentElement.lang !== next) document.documentElement.lang = next;
  }, []);
  return null;
}
