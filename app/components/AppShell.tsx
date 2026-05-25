'use client';

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

  if (NO_SHELL_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col">
        <HealthBanner />
        <div className="flex-1 min-w-0 pb-20 lg:pb-0">{children}</div>
      </main>
      <MobileNav />
      <CommandPalette />
      <HelpOverlay />
      <ServersDrawer />
    </div>
  );
}
