'use client';

import Link from 'next/link';

/**
 * #1636-P1 —— 「网络还没确定」时的显式提示。
 *
 * 为什么需要它：`NetworkProvider` 解析结束时 `ready=true`，但**解析完成 ≠ 已选到网络**
 * （账号可能一个网络都没有，或者 /api/hub/networks 失败）。这种情况下如果继续发
 * 不带 network_id 的请求，会先按未选择网络的状态读取数据：多网络账号可能收到400，
 * 单网络账号也会产生一次不必要的、未显式指定网络的读取。
 *
 * 所以：ready 且 networkId 为空 ⇒ 不发请求、不显示空态，显示这个提示。
 */
export function NetworkRequiredNotice({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      data-testid="network-required"
      className={`rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-[var(--warning)] ${className}`}
    >
      还没有确定当前网络。请先在左侧选择网络，或前往
      <Link href="/settings/networks" className="mx-1 underline">网络管理</Link>
      查看可用网络。
    </div>
  );
}
