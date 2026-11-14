'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { HealthBanner } from './HealthBanner';
import UpdateBanner from './UpdateBanner';
import dynamic from 'next/dynamic';
// 命令面板只在 ⌘K 时才需要。静态 import 会把它和它的索引逻辑塞进**每个页面**的首屏包，
// 而 2026-11-09 的时间线显示：JS 264KB 在 1.15s 下完、首个 API 请求在 2.97s，
// 中间 1.8s 全是执行 + 水合 —— 首屏最大的成本在这里，不在接口。
// 改成 dynamic + 「idle 或首次按 ⌘K 才挂载」：不改变行为，只把它挪出关键路径。
const CommandPalette = dynamic(() => import('./CommandPalette').then(m => m.CommandPalette), {
  ssr: false,
  loading: () => null,
});
import { HelpOverlay } from './HelpOverlay';
import { ServersDrawer } from './ServersDrawer';
import { MobileNav } from './MobileNav';
import { useRadiusTier } from '../lib/useRadiusTier';
import { useIdle } from '../lib/use-idle';
import { useEffect, useRef, useState } from 'react';

const NO_SHELL_PATHS = ['/login'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 小控件圆角（item=8）：客户端按渲染高度定义，CSS 选不到，只能在挂载后量一次。
  useRadiusTier();
  // 命令面板：idle 后挂载；若用户在这之前就按了 ⌘K / Ctrl+K，立刻挂载（行为不变）。
  const idle = useIdle(2000);
  const [paletteForced, setPaletteForced] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') setPaletteForced(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // `.556`：把内容区「底部让位」镜像成 --shell-bottom-pad（移动 80 / 桌面 0）。
  // 只写变量，不改变任何布局；页面根用它把 100dvh 扣干净，移动端一屏页就不会多滚 80px。
  // 注意：/nodes 有专门的防自激高度逻辑（见 NodesView 注释），本变量不参与那段计算。
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const apply = () => {
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      document.documentElement.style.setProperty('--shell-bottom-pad', `${Math.round(pad)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[100dvh] max-w-full overflow-x-hidden">
      {/* 键盘用户的第一站：跳过侧栏（20+ 个导航项）直达主内容。
          只在 Tab 聚焦时可见，视觉用户不受影响。 */}
      <a
        href="#anet-main-content"
        data-testid="skip-to-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-[var(--bg-elevated)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--fg)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        跳到主内容
      </a>
      <Sidebar />
      {/* R25 of #190: pair the existing bottom safe-area padding with a
          top one so the HealthBanner clears the iOS status bar when
          launched as an installed PWA (statusBarStyle: black-translucent
          + viewportFit: cover, see app/layout.tsx). On non-PWA contexts
          env(safe-area-inset-top) is 0, so this is a no-op for browser
          tab visits. */}
      <main
        id="anet-main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 max-w-full overflow-x-hidden flex flex-col pt-[env(safe-area-inset-top)] outline-none"
      >
        <HealthBanner />
        <UpdateBanner />
        <div ref={contentRef} className="flex-1 min-w-0 max-w-full overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      </main>
      <MobileNav />
      {(idle || paletteForced) && <CommandPalette />}
      <HelpOverlay />
      <ServersDrawer />
    </div>
  );
}
