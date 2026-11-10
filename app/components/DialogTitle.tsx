'use client';

import type { ReactNode } from 'react';

/**
 * 弹窗标题块（.454）。
 *
 * 背景：5 个 Node* 弹窗此前各自复制了同一段结构
 *   <div className="truncate text-[14px] text-[var(--fg)]">标题<span>别名</span></div>
 * 复制 5 次意味着字号 / 颜色 / 截断策略各有 5 个来源，改一处必漏几处。
 *
 * 本组件只负责「标题块」（h2 + 别名 + 副标题），**不接管右侧操作区**：
 * 每个弹窗仍保留自己的 header 行与按钮，重排面越小越不容易改坏。
 *
 * a11y（评审指出的硬要求）：标题是语义 <h2 id>，弹窗容器用 aria-labelledby 关联，
 * 之前 5 个模态框都没有可访问名称，屏幕阅读器只会念「对话框」。
 */
export function DialogTitle({
  id,
  title,
  hint,
  subtitle,
  subtitleTestId,
  subtitleClassName,
}: {
  id: string;
  title: ReactNode;
  hint?: ReactNode;
  subtitle?: ReactNode;
  subtitleTestId?: string;
  subtitleClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="truncate text-[14px] text-[var(--fg)]">
        {title}
        {hint != null && <span className="ml-2 text-[11px] text-[var(--fg-muted)]">{hint}</span>}
      </h2>
      {subtitle != null && (
        <div
          className={`mt-0.5 text-[11px] text-[var(--fg-dim)]${subtitleClassName ? ` ${subtitleClassName}` : ''}`}
          data-testid={subtitleTestId}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
