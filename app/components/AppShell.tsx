'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { HealthBanner } from './HealthBanner';
import { CommandPalette } from './CommandPalette';
import { HelpOverlay } from './HelpOverlay';
import { ServersDrawer } from './ServersDrawer';
import { MobileNav } from './MobileNav';

const NO_SHELL_PATHS = ['/login'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobileOpen = openPath === pathname;
  const setMobileOpen = (open: boolean) => setOpenPath(open ? pathname : null);

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[100dvh] max-w-full">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      {/* R25 of #190: pair the existing bottom safe-area padding with a
          top one so the HealthBanner clears the iOS status bar when
          launched as an installed PWA (statusBarStyle: black-translucent
          + viewportFit: cover, see app/layout.tsx). On non-PWA contexts
          env(safe-area-inset-top) is 0, so this is a no-op for browser
          tab visits. */}
      <main className="flex min-w-0 max-w-full flex-1 flex-col overflow-x-hidden pt-[env(safe-area-inset-top)]">
        <div className="sticky top-0 z-50 flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
          <span className="truncate text-sm font-medium text-[var(--fg)]">Agent Network</span>
        </div>
        <HealthBanner />
        <div className="min-w-0 max-w-full flex-1 overflow-x-hidden pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
      </main>
      <MobileNav />
      <CommandPalette />
      <HelpOverlay />
      <ServersDrawer />
    </div>
  );
}
