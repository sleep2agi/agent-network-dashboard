import { test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const OUT_DIR = path.resolve(__dirname, '../test-results/theme-screenshots');
const THEMES = ['cyber', 'light', 'mint', 'sunset'] as const;

const PAGES = [
  { name: 'overview', path: '/' },
  { name: 'nodes', path: '/nodes' },
  { name: 'tasks', path: '/tasks' },
  { name: 'settings', path: '/settings' },
];

async function login(context: any) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const setCookie = res.headers()['set-cookie'] || '';
  const match = setCookie.match(/anet_dashboard_session=([^;]+)/);
  if (match) {
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: decodeURIComponent(match[1]),
      domain: 'localhost',
      path: '/',
    }]);
  }
}

test.beforeAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
});

for (const theme of THEMES) {
  for (const pg of PAGES) {
    test(`${theme} — ${pg.name}`, async ({ page, context }) => {
      await login(context);
      // Set theme in localStorage *before* the page boots — the inline
      // bootstrap script reads localStorage on first paint, otherwise it
      // resets data-theme back to "cyber" during hydration.
      await context.addInitScript((t) => {
        try { localStorage.setItem('anet-theme', t); } catch {}
      }, theme);
      await page.goto(`${BASE}${pg.path}`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForTimeout(600);
      await page.setViewportSize({ width: 1440, height: 900 });
      const file = path.join(OUT_DIR, `${theme}-${pg.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`saved ${file}`);
    });
  }
}
