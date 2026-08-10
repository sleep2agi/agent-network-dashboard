import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const NODE_COUNT = 180;

const sessions = Array.from({ length: NODE_COUNT }, (_, index) => ({
  alias: `virtual-agent-${String(index).padStart(3, '0')}`,
  status: index % 3 === 0 ? 'working' : 'idle',
  network_id: 'net_virtual',
}));

async function login(page: Page) {
  const response = await page.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const match = (response.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
  if (!match) throw new Error('dashboard login did not return a session cookie');
  await page.context().addCookies([{
    name: 'anet_dashboard_session',
    value: decodeURIComponent(match[1]),
    domain: new URL(BASE).hostname,
    path: '/',
  }]);
}

async function mockFleet(page: Page) {
  let statusRead = 0;
  await page.route('**/api/hub/status**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessions: sessions.map(session => ({ ...session, task: `refresh-${statusRead}` })),
    }),
  }));
  page.on('request', request => {
    if (request.url().includes('/api/hub/status')) statusRead += 1;
  });
  await page.route('**/api/hub/nodes**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ nodes: sessions.map(({ alias }) => ({ alias, team: null, tags: [] })) }),
  }));
  await page.route('**/api/hub/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      sse_sessions: Object.fromEntries(sessions.map(({ alias }) => [`net_virtual:${alias}`, 1])),
    }),
  }));
  await page.route('**/api/hub/tasks**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tasks: [] }),
  }));
  await page.route('**/api/hub/stats**', route => route.fulfill({ status: 200, body: '{}' }));
  await page.route('**/api/hub/messages**', route => route.fulfill({ status: 200, body: '{"messages":[]}' }));
}

test('180-agent rail keeps the DOM bounded and can scroll to the final agent', async ({ page }) => {
  await login(page);
  await mockFleet(page);
  await page.goto(`${BASE}/nodes`);

  const rail = page.locator('[data-node-list-rail][data-node-list-count]').first();
  const scroll = page.locator('[data-testid="node-list-scroll"]').first();
  await expect(rail).toHaveAttribute('data-node-list-count', String(NODE_COUNT));

  const rows = rail.locator('[data-node-list-item]');
  await expect.poll(() => rows.count()).toBeGreaterThan(0);
  expect(await rows.count()).toBeLessThan(50);
  await expect(rail.locator('[data-node-list-alias="virtual-agent-000"]')).toHaveAttribute('data-selected', 'true');

  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rail.locator('[data-node-list-alias="virtual-agent-179"]')).toBeVisible();
  await expect(scroll).not.toHaveAttribute('data-virtual-start', '0');
  expect(await rows.count()).toBeLessThan(50);

  // useSessions refreshes every five seconds. A data refresh must not treat
  // the unchanged selected alias as a new selection and snap the operator
  // away from the section of the fleet they are browsing.
  await page.waitForTimeout(5_500);
  await expect(rail.locator('[data-node-list-alias="virtual-agent-179"]')).toBeVisible();
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(7_000);

  // A deep link starts with its selected row outside the initial window.
  // The index-based selection effect must scroll and mount that exact row.
  await page.goto(`${BASE}/nodes/virtual-agent-179`);
  await expect(rail.locator('[data-node-list-alias="virtual-agent-179"]')).toHaveAttribute('data-selected', 'true');
  await expect(rail.locator('[data-node-list-alias="virtual-agent-179"]')).toBeVisible();
  expect(await scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});
