/**
 * Suspense fallback for /nodes（.441）。
 *
 * 为什么不是「直接渲染 <NodesView />」当 fallback：
 * NodesView 自己会取数（SWR），fallback 与真内容各挂一次 ⇒ 首屏多打 2 个 Hub 请求
 * （实测 /api/hub/status 与 /api/hub/nodes 各 ×2）。这里刻意做成**纯静态、零 Hook**：
 * 只画与真实布局同宽的骨架，服务端流式补齐后原地替换，请求次数保持 ×1。
 *
 * 尺寸对齐真实组件（不要凭感觉改）：
 *   · 侧栏列宽 280px（md 起）；行高 53px、头像 32px —— 与 NodeList 行一致，
 *     这样真内容到达时不会出现整体跳动。
 *   · 颜色只用既有 token（--bg / --col-list / --col-hairline / --bg-elevated），
 *     不引入新的色值，避免撞设计四族约束。
 */
export function NodesSkeleton() {
  return (
    <div
      data-testid="nodes-skeleton"
      className="h-[100dvh] max-w-full overflow-hidden bg-[var(--bg)] flex"
      aria-busy="true"
    >
      <aside className="flex flex-col w-full md:w-[280px] shrink-0 h-full min-h-0 bg-[var(--col-list)]">
        {/* 搜索框占位（真实 NodeList 顶部有搜索） */}
        <div className="px-3 py-2.5 border-b border-[var(--col-hairline)]">
          <div className="h-7 rounded-lg bg-[var(--bg-elevated)] animate-pulse" />
        </div>
        {/* 行占位：高度与真实行一致，避免真内容到达时跳动 */}
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3 border-b border-[var(--col-hairline)]"
              style={{ height: 53, minHeight: 53 }}
            >
              <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="h-2.5 rounded bg-[var(--bg-elevated)] animate-pulse" style={{ width: `${52 + ((i * 13) % 34)}%` }} />
                <div className="mt-1.5 h-2 rounded bg-[var(--bg-elevated)] animate-pulse" style={{ width: `${70 - ((i * 7) % 26)}%`, opacity: 0.6 }} />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="hidden md:flex flex-1 min-w-0 items-center justify-center">
        <div className="text-[12px] text-[var(--fg-dim)]">正在读取节点…</div>
      </div>
    </div>
  );
}
