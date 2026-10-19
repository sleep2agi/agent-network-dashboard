'use client';

// 需求评论正文的 Markdown 渲染（#1831 的 Web 侧）。
//
// Activity 里评论和「字段变更」混在一条时间线：评论正文是 Agent 用 requirements_comment 写的
// Markdown，admin 2026-10-19 截图指出它此前按 `whitespace-pre-wrap` 纯文本显示，`## 归因更正`、
// `**错误**`、反引号 `agent_owner` 全露出原字符。客户端那半边在 agent-network-app 的 #961。
//
// 渲染器沿用本仓已有的 react-markdown + remark-gfm（Description 与 TaskChatPanel 都在用）：
// 不拼 HTML 字符串，也不开 rehype-raw，所以评论里的标签只会当文字显示。
// 外链统一新窗口打开并带 noopener。
//
// 用 prose 而不是手写每个标签的样式：和 Description 的观感一致，也不用在颜色棘轮里新增色值。

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:no-underline">
      {children}
    </a>
  ),
};

export default function CommentMarkdown({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      className="prose prose-invert prose-sm mt-1 max-w-none break-words prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-pre:my-1 prose-pre:border prose-pre:border-[var(--border)] prose-pre:bg-[var(--bg)] prose-table:my-1 prose-li:my-0"
      data-testid="requirement-comment-markdown"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>{text}</ReactMarkdown>
    </div>
  );
}
