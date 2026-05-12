'use client';

import { useEffect, useState } from 'react';

const THEMES = [
  { id: 'cyber',  label: 'Cyber',  emoji: '🌃', desc: '默认深色' },
  { id: 'light',  label: 'Light',  emoji: '☀️',  desc: '浅色简洁' },
  { id: 'mint',   label: 'Mint',   emoji: '🌿', desc: '薄荷绿' },
  { id: 'sunset', label: 'Sunset', emoji: '🌅', desc: '暖色橙紫' },
] as const;

type ThemeId = typeof THEMES[number]['id'];
const THEME_KEY = 'anet-theme';

function applyTheme(theme: ThemeId) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Apply persisted theme on first render so we don't flash dark before
  // user-selected light. Initial value comes from cookie/localStorage.
  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as ThemeId) || 'cyber';
    applyTheme(stored);
  }, []);
  return <>{children}</>;
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>('cyber');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_KEY) as ThemeId) || 'cyber';
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function pick(next: ThemeId) {
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    setOpen(false);
  }

  const current = THEMES.find(t => t.id === theme) || THEMES[0];

  return (
    <div className="relative">
      <button
        aria-label="切换主题"
        onClick={() => setOpen(!open)}
        className="px-2.5 py-1.5 rounded-md text-xs flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        style={{ background: 'var(--bg-elevated)', color: 'var(--fg)', border: '1px solid var(--border)' }}
      >
        <span aria-hidden>{current.emoji}</span>
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 rounded-md min-w-[160px] py-1 shadow-lg"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          >
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:opacity-80"
                style={{
                  background: t.id === theme ? 'var(--bg-elevated)' : 'transparent',
                  color: 'var(--fg)',
                }}
              >
                <span aria-hidden>{t.emoji}</span>
                <span className="flex-1">{t.label}</span>
                <span style={{ color: 'var(--fg-dim)' }} className="text-[10px]">{t.desc}</span>
                {t.id === theme && <span style={{ color: 'var(--accent)' }}>•</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
