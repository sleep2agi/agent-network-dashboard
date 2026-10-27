'use client';

import Link from 'next/link';

/**
 * #1636-P1 —— 「网络还没确定」时的显式提示。
 *
 * 为什么需要它：`NetworkProvider` 解析结束时 `ready=true`，但**解析完成 ≠ 已选到网络**
 * （账号可能一个网络都没有，或者 /api/hub/networks 失败）。这种情况下如果继续发
 * 不带 network_id 的请求，等于把「无 scope」的全局数据当成用户所属网络的数据来渲染 ——
 * 多网络账号会 400，单网络账号会先看到别人的数据再被覆盖。
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
      还没有确定当前网络，先<Link href="/admin" className="mx-1 underline">选择或加入一个网络</Link>，再回来看这里的数据。
    </div>
  );
}
