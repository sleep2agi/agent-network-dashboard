'use client';

// 需求评论正文的 Markdown 渲染（#1831 的 Web 侧）。
//
// Activity 里评论和「字段变更」混在一条时间线：评论正文是 Agent 用 requirements_comment 写的
// Markdown，admin 2026-10-19 截图指出它此前按 `whitespace-pre-wrap` 纯文本显示，`## 归因更正`、
// `**错误**`、反引号 `agent_owner` 全露出原字符。客户端那半边在 agent-network-app 的 #961。
//
// 渲染器沿用本仓已有的 react-markdown + remark-gfm：不拼 HTML 字符串，也不开 rehype-raw，
// 所以评论里写标签只会当文字。
//
// ⚠️ 不要用 `prose` 类：本仓是 Tailwind v4，**没装 @tailwindcss/typography**，
// `prose` 在这里是空类；而 Tailwind 的 preflight 会把 h1–h6 的 font-size/weight 重置成
// 继承、把 ul/ol 的 list-style 清掉 —— 结果标题和列表看起来和正文一模一样（等于「去掉了 # 号
// 但没渲染」）。所以这里按元素逐个给类，和 TaskChatPanel 的 markdown 组件表同一思路，
// 颜色只用语义 token。

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-1 whitespace-pre-wrap break-words leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1 mt-3 text-base font-semibold text-[var(--fg)]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-3 text-sm font-semibold text-[var(--fg)]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-[var(--fg-muted)]">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--fg-muted)]">{children}</h4>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--fg)]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="line-through opacity-70">{children}</del>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--info)] underline hover:no-underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="break-words">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-[var(--border)] pl-2.5 text-[var(--fg-muted)]">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-[var(--border)]" />,
  // 行内 code 与代码块共用 `code`；react-markdown 会给围栏代码的父级 <pre> 单独回调，
  // 所以这里只画行内样式，代码块在 `pre` 里统一处理。
  code: ({ children }) => (
    <code className="rounded bg-[var(--code-bg)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--code-fg)]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--code-bg)] px-2.5 py-2 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--code-bg)]">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-[var(--border)]">{children}</tr>,
  th: ({ children }) => (
    <th className="border border-[var(--border)] px-2 py-1 text-left font-semibold text-[var(--fg)]">{children}</th>
  ),
  td: ({ children }) => <td className="border border-[var(--border)] px-2 py-1 align-top">{children}</td>,
};

export default function CommentMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-1 break-words text-sm text-[var(--fg-muted)]" data-testid="requirement-comment-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
