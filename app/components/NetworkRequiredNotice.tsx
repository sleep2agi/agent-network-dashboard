'use client';

import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { useHealth } from '../lib/hooks';

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
  // `.603`：这个提示有两种成因，但旧实现只有一套文案 ——「请先在左侧选择网络」。
  //   ① 账号确实没有网络 / 用户没选 → 选网络是对的指令；
  //   ② /api/hub/networks 读不到（Hub 不可达）→ 让用户去"选择网络"是把"读不到"说成"你没选"，
  //      而这正是今晚在侧栏 / 统计条 / 节点列表修过的同一个坑（key=null ⇒ 不发请求也不报错）。
  //   用 /api/hub/health 的 error 区分两者（同 vscroll/site-scroll 的口径：读不到就直说）。
  const { error } = useHealth();
  const { mutate } = useSWRConfig();
  if (error) {
    return (
      <div
        role="alert"
        data-testid="network-required"
        className={`rounded-lg border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-[var(--danger)] ${className}`}
      >
        读不到网络信息（Hub 不可达）—— 这不是「你没有网络」。
        <button
          type="button"
          onClick={() => mutate((k: unknown) => typeof k === 'string' && k.startsWith('/api/hub/'))}
          className="ml-1 underline underline-offset-2"
        >
          重试
        </button>
      </div>
    );
  }
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
