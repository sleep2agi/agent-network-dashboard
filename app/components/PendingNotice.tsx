import type { ReactNode } from 'react';

/**
 * Marker for a surface the current Hub can describe, but this dashboard
 * build does not send yet. The words are the product copy for that gap.
 */
/** Mild status (spec §5.13): a warn tag, not a second banner. Detail stays in the tooltip. */
export function PendingNotice({ children }: { children?: ReactNode }) {
  const detail = typeof children === 'string' ? children : '后端开发中，敬请期待';
  return (
    <span
      className="inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium tracking-[0.04em]"
      style={{
        background: 'color-mix(in srgb, var(--warn) 14%, transparent)',
        color: 'var(--warn)',
      }}
      title={detail}
    >
      演示数据
    </span>
  );
}
