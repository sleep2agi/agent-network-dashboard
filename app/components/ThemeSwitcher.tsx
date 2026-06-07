'use client';

import { useEffect } from 'react';

// Cleanup (issue #4) — less is more. The dashboard is designed dark/cyber;
// the light / mint / sunset themes were never verified and the picker just
// added a knob nobody validated. We lock to the single cyber theme and drop
// the switcher control. (The unused [data-theme] CSS branches in globals.css
// are now dead but harmless — left for a later dedicated CSS sweep.)

const THEME = 'cyber';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', THEME);
    }
  }, []);
  return <>{children}</>;
}
