import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const OUTPUT = resolve(process.env.TASK_EVENT_SCREENSHOT_DIR || 'test-results/test167-task-event-fields');
const TASK_ID = 'synthetic-task-event-fields';

test.setTimeout(90_000);

test('legacy task events keep a visible label and expose actor/detail audit fields', async ({ page, context }) => {
  mkdirSync(OUTPUT, { recursive: true });
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const cookie = (login.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
  if (!cookie) throw new Error('dashboard login did not return a session cookie');
  await context.addCookies([{
    name: 'anet_dashboard_session', value: decodeURIComponent(cookie[1]),
    domain: new URL(BASE).hostname, path: '/', sameSite: 'Lax',
  }]);

  await page.addInitScript(() => window.sessionStorage.setItem('anet_network_id', 'net_synthetic'));
  await page.route('**/api/hub/networks**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ networks: [{ network_id: 'net_synthetic', network_name: 'Synthetic network' }] }),
  }));
  await page.route('**/api/hub/tasks**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ tasks: [{
      task_id: TASK_ID, network_id: 'net_synthetic', from_name: 'scheduler-demo', to_name: 'worker-demo',
      status: 'delivered', priority: 'normal', content: 'Synthetic audit event demonstration', result: '',
      created_at: '2026-08-10 08:00:00', updated_at: '2026-08-10 08:30:00',
      delivered_at: '2026-08-10 08:00:01', started_at: '', completed_at: '', expires_at: '',
    }], count: 1 }),
  }));
  await page.route('**/api/hub/task-events**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ events: [
      {
        id: 1, event_type: null, actor: 'hub', from_status: 'created', to_status: 'delivered',
        detail: 'Legacy row retained without an event_type.', created_at: '2026-08-10 08:00:01',
      },
      {
        id: 2, event_type: 'task.stale.30m', actor: 'hub-watcher', from_status: 'delivered', to_status: 'delivered',
        detail: 'Target had not started after 30 minutes.', created_at: '2026-08-10 08:30:01',
      },
    ] }),
  }));
  for (const path of ['status', 'nodes', 'stats', 'messages']) {
    await page.route(`**/api/hub/${path}**`, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(path === 'nodes' ? { nodes: [] } : {}),
    }));
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE}/tasks/${TASK_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="tasks-layout"]')).toBeVisible({ timeout: 60_000 });
  const events = page.locator('[data-testid="task-detail-events"]');
  await expect(events).toBeVisible({ timeout: 30_000 });
  await expect(events).toHaveAttribute('data-events-count', '2');
  await page.screenshot({ path: join(OUTPUT, 'task-event-fields.png'), fullPage: false });

  const rows = page.locator('[data-testid="task-detail-event-row"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('[data-testid="task-event-label"]')).toHaveText('delivered');
  await expect(rows.nth(0).locator('[data-testid="task-event-actor"]')).toHaveText('by hub');
  await expect(rows.nth(0).locator('[data-testid="task-event-detail"]')).toHaveText(
    'Legacy row retained without an event_type.',
  );
  await expect(rows.nth(1).locator('[data-testid="task-event-label"]')).toHaveText('task.stale.30m');
  await expect(rows.nth(1).locator('[data-testid="task-event-actor"]')).toHaveText('by hub-watcher');
  await expect(rows.nth(1).locator('[data-testid="task-event-detail"]')).toHaveText(
    'Target had not started after 30 minutes.',
  );
  await expect(rows.nth(1).locator('[data-testid="task-event-stale-context"]')).toHaveText(
    'Informational delivery observation; tasks that do not require a reply may also appear here.',
  );
  await expect(rows.nth(0).locator('[data-testid="task-event-stale-context"]')).toHaveCount(0);

  // The fixed four-step timeline remains task-timestamp based.
  await expect(page.locator('[data-testid="timeline-step-created"]')).toHaveAttribute('data-timeline-done', 'true');
  await expect(page.locator('[data-testid="timeline-step-delivered"]')).toHaveAttribute('data-timeline-done', 'true');
  await expect(page.locator('[data-testid="timeline-step-started"]')).toHaveAttribute('data-timeline-done', 'false');
  await expect(page.locator('[data-testid="timeline-step-completed"]')).toHaveAttribute('data-timeline-done', 'false');
});
