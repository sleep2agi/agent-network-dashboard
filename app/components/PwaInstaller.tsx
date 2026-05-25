'use client';

import { useEffect } from 'react';

export function PwaInstaller() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // PWA install support is best-effort; the dashboard must still work
      // in locked-down enterprise browsers where service workers are blocked.
    });
  }, []);

  return null;
}
