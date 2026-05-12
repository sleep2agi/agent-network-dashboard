import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3000';

async function login(context: any) {
  // Use legacy login (works reliably in Docker)
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const headers = res.headers();
  const setCookie = headers['set-cookie'] || '';
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

test.describe('Dashboard E2E', () => {
  test('1. login page renders', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('text=Agent Network')).toBeVisible();
  });

  test('2. overview loads after login', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(3000);
    await expect(page.locator('text=Online')).toBeVisible();
  });

  test('3. tasks page', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/tasks`);
    await page.waitForTimeout(2000);
    const h = page.locator('h1', { hasText: 'Tasks' });
    await expect(h).toBeVisible();
  });

  test('4. nodes page', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/nodes`);
    await page.waitForTimeout(2000);
    const h = page.locator('h1', { hasText: 'Nodes' });
    await expect(h).toBeVisible();
  });

  test('5. messages page', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/messages`);
    await page.waitForTimeout(2000);
    const h = page.locator('h1', { hasText: 'Messages' });
    await expect(h).toBeVisible();
  });

  test('6. settings page', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/settings`);
    await page.waitForTimeout(2000);
    const h = page.locator('h1', { hasText: 'Settings' });
    await expect(h).toBeVisible();
  });

  test('7. admin page', async ({ page, context }) => {
    await login(context);
    await page.goto(`${BASE}/admin`);
    await page.waitForTimeout(2000);
    const h = page.locator('h1', { hasText: 'Admin' });
    await expect(h).toBeVisible();
  });
});
