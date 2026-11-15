import Link from 'next/link';

// 自定义 404（2026-11-15，`.574`）
//
// 起因：逐页双档体检访问了一个不存在的路由，看到的是 Next.js 默认页 ——
// 中文界面里蹦出一句英文 "This page could not be found."。
// 403/404 是用户最容易撞到的"非正常路径"，它比任何正常页面都更影响"这系统是否专业"的判断。
export default function NotFound() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center px-6 py-20">
      <div className="w-full max-w-md text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[var(--fg-dim)]">404</p>
        <h1 className="mt-3 text-xl font-semibold text-[var(--fg)]">页面不存在</h1>
        {/* 文案刻意压到一行（1366 下 21 个汉字）：`.574` 实测 35 字会断成两行，
            且 text-balance 把「已过期」切成「已过 / 期」。短句 + 不换行最稳。 */}
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--fg-muted)]">
          这个地址没有对应页面：链接过期或拼写有误。
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] transition-colors hover:bg-[var(--hover-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            返回概览
          </Link>
          <Link
            href="/legion/3d"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            打开军团 3D
          </Link>
          <Link
            href="/nodes"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:bg-[var(--hover-tint)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            节点列表
          </Link>
        </div>
        <p className="mt-6 text-[11px] text-[var(--fg-dim)]">
          从侧边栏进入也可以：节点 · 军团 · 任务 · 需求 · 设置。
        </p>
      </div>
    </main>
  );
}
