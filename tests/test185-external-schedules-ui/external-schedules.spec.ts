import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const OUTPUT = resolve(process.env.TEST185_SCREENSHOT_DIR || 'test-results/test185-external-schedules');

test.setTimeout(90_000);

test('node Info renders reported external schedules without host paths or commands', async ({ page, context }) => {
  mkdirSync(OUTPUT, { recursive: true });
  let observedAt = new Date().toISOString();
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const cookie = (login.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
  if (!cookie) throw new Error('dashboard login did not return a session cookie');
  await context.addCookies([{
    name: 'anet_dashboard_session', value: decodeURIComponent(cookie[1]),
    domain: new URL(BASE).hostname, path: '/', sameSite: 'Lax',
  }]);

  await page.route('**/api/hub/session**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      session: {
        alias: 'pstation-ops', status: 'idle', agent: 'agent-node:codex', server: 'demo-host',
        external_schedules: {
          observed_at: observedAt,
          schedules: [{
            id: 'pstation-smoke', name: 'P station Playwright smoke', kind: 'playwright',
            frequency: '*/5 * * * *', last_run_at: '2026-08-10T01:02:03.000Z',
            last_status: 'failed', last_error: 'homepage returned 503',
            next_run_at: '2026-08-10T01:07:03.000Z', log_ref: 'pstation-smoke.log', enabled: true,
            log_path: '/var/private/should-never-render.log', command: 'cat /etc/passwd',
          }],
        },
      }, inbox: [], sse: 1,
    }),
  }));
  await page.route('**/api/hub/task-events**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }),
  }));
  await page.route('**/api/hub/tasks**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }),
  }));

  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto(`${BASE}/node?alias=pstation-ops`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Info' }).click();
  if (process.env.TEST185_BEFORE_SCREENSHOT === '1') {
    await page.screenshot({ path: join(OUTPUT, 'external-schedules-before.png'), fullPage: false });
  }
  const card = page.getByTestId('external-schedules-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('P station Playwright smoke');
  await expect(card).toContainText('failed');
  await expect(card).toContainText('homepage returned 503');
  await expect(card).toContainText('log: pstation-smoke.log');
  await expect(card).toContainText('reported');
  await expect(card).toContainText('Reported by the node; Agent Network does not execute or verify these schedules.');
  await expect(card).not.toContainText('/var/private');
  await expect(card).not.toContainText('cat /etc/passwd');
  await page.screenshot({ path: join(OUTPUT, 'external-schedules.png'), fullPage: false });

  observedAt = new Date(Date.now() - 120_000).toISOString();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/hub/session')),
    page.goto(`${BASE}/node?alias=pstation-ops`, { waitUntil: 'domcontentloaded' }),
  ]);
  await page.getByRole('button', { name: 'Info' }).click();
  await expect(page.getByTestId('external-schedules-card')).toContainText('stale report');
});
