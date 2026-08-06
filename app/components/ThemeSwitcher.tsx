'use client';

import { useEffect } from 'react';

// #217 S6 — verified themes: cyber (dark), light (white), and slack
// (Vincent 2026-07-16 via api channel: "其他的就搞成那种 Slack 方式吧…快速搞一个"
// — Slack-style is now the DEFAULT look; the network/topology page keeps its
// showcase visuals, see TopoGraph's data-skin exemption).
//
// Mechanism: `slack` is implemented as a SKIN on top of the light theme —
// applyTheme sets `data-theme="light"` (so every existing light compat-shim
// in globals.css applies unchanged) plus `data-skin="slack"` which the
// slack-only overrides key on (aubergine rail, Slack-blue accent, de-noise).
// This keeps the fast first version to globals.css + three tiny component
// touches instead of a full hex→token sweep (that sweep stays scheduled as
// redesign Phase 0 next version).

export const THEMES = new Set(['cyber', 'light', 'slack']);

/** Apply a theme choice to <html>. Single owner of the data-theme/data-skin
 *  contract — Settings and Cmd+K call this too, so the skin attribute can
 *  never desync from the theme attribute. */
export function applyTheme(t: string) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  if (t === 'slack') {
    el.setAttribute('data-theme', 'light');
    el.setAttribute('data-skin', 'slack');
  } else {
    el.setAttribute('data-theme', t);
    el.removeAttribute('data-skin');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    // ROLLBACK (Vincent 07-20): the classic dark theme is the default again
    // — he prefers the original look and doesn't want a Slack copy as the
    // face of the product. 'slack' stays available as an explicit Settings
    // choice until the original agent-network theme replaces it. Users who
    // explicitly picked a theme keep their pick; everyone else returns to
    // cyber automatically (the slack-default window never wrote storage).
    let t = 'cyber';
    try {
      const saved = localStorage.getItem('anet-theme');
      if (saved && THEMES.has(saved)) t = saved;
    } catch {}
    applyTheme(t);
  }, []);
  return <>{children}</>;
}
