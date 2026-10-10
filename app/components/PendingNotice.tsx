import type { ReactNode } from 'react';

/**
 * Marker for a surface the current Hub can describe, but this dashboard
 * build does not send yet. The words are the product copy for that gap.
 */
export function PendingNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
      <div className="font-medium">演示数据 · 后端开发中，敬请期待</div>
      {children ? <p className="mt-1 text-amber-100/80">{children}</p> : null}
    </div>
  );
}
