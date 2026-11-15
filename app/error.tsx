'use client';

import Link from 'next/link';

// 中文错误边界（2026-11-15，`.578`）
//
// 起因：本地复看 /admin 时页面崩了，用户看到的是 Next 默认英文页：
//   "This page couldn't load / Reload to try again, or go back."
// 与 404 同理：错误页是用户最容易撞到的"非正常路径"，它比正常页面更影响
// "这系统是否专业"的判断。这里给出中文标题、可执行动作与错误摘要（便于反馈）。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[50vh] items-center justify-center px-6 py-20">
      <div className="w-full max-w-md text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--fg-dim)]">出错了</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--fg)]">这个页面没能加载</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--fg-muted)]">
          可能是网络中断、Hub 暂时不可用，或页面遇到异常。可以重试，或返回概览继续用其它页面。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] transition-colors hover:bg-[var(--hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            重试
          </button>
          <Link
            href="/"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            返回概览
          </Link>
        </div>
        {error?.digest && (
          <p className="mt-6 font-mono text-[11px] text-[var(--fg-dim)]">错误编号 {error.digest}</p>
        )}
      </div>
    </main>
  );
}
