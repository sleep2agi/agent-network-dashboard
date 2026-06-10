'use client';

import { useEffect } from 'react';

// #217 S6 — two verified themes: cyber (dark, default) and light (white,
// Vincent-requested, tokens restored from pre-R8 history). The issue #4
// cleanup locked this to cyber because the old light/mint/sunset themes
// were unverified; light is now owned by Settings → Appearance, so the
// provider honors the persisted choice again. Anything else in storage
// (old mint/sunset values) falls back to cyber.

const THEMES = new Set(['cyber', 'light']);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let t = 'cyber';
    try {
      const saved = localStorage.getItem('anet-theme');
      if (saved && THEMES.has(saved)) t = saved;
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, []);
  return <>{children}</>;
}
