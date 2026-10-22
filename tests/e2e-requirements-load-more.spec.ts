import { expect, test } from '@playwright/test';
import http from 'node:http';

/**
 * #1636 — 需求列表「加载更多」不得把已加载的行换成骨架屏。
 *
 * 这条断言写在浏览器里，因为缺陷本身就是渲染分支的事：旧实现两条加载路径共用
 * 一个 `loading`，点「加载更多」时 `loading ? 骨架屏 : 列表` 立刻翻到骨架屏，
 * 200 行需求在追加期间从屏幕上消失。纯源码契约测不出这件事。
 *
 * 用进程内 stub Hub（COMMHUB_URL 默认 http://localhost:9999，见 playwright.config.ts），
 * 不连生产、不读真实数据；第二页故意慢 1.2s，让「追加期间」是一个可观测窗口。
 */

const ROWS = [
  { id: 'req_a', seq: 101, name: 'stub row one', column: 'pool', priority: 'normal', tags: ['ANet'] },
  { id: 'req_b', seq: 102, name: 'stub row two', column: 'doing', priority: 'high', tags: ['ANet'] },
  { id: 'req_c', seq: 103, name: 'stub row three', column: 'done', priority: 'low', tags: ['ANet'] },
];
const PAGE2 = [
  { id: 'req_d', seq: 104, name: 'stub row four', column: 'pool', priority: 'normal', tags: ['ANet'] },
  { id: 'req_e', seq: 105, name: 'stub row five', column: 'done', priority: 'normal', tags: ['ANet'] },
];

let server: http.Server;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:9999');
    if (url.pathname === '/api/requirements') {
      const cursor = url.searchParams.get('cursor');
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(cursor
          ? { ok: true, requirements: PAGE2, has_more: false, next_cursor: null }
          : { ok: true, requirements: ROWS, has_more: true, next_cursor: 'c2' }));
      }, cursor ? 3000 : 100);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(9999, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('加载更多期间已加载的行留在屏幕上，追加完才变成 5 行', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' } });
  expect(login.status(), await login.text()).toBe(200);

  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  await page.getByRole('button', { name: /加载更多/ }).click();
  // 追加在飞：列表必须还在，骨架屏不得出现（旧实现这里是 0 行 + 8 个骨架）。
  await expect(page.getByRole('button', { name: /加载中/ })).toBeVisible();
  // 追加在飞：短超时断言当下这一刻，旧实现这里是 0 行。
  await expect(page.locator('ul li')).toHaveCount(3, { timeout: 600 });
  await expect(page.locator('.animate-pulse')).toHaveCount(0);

  await expect(page.locator('ul li')).toHaveCount(5, { timeout: 10000 });
});

test('376px 窄屏下需求列表不横向溢出', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' } });
  expect(login.status(), await login.text()).toBe(200);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/requirements');
  await expect(page.locator('ul li').first()).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.inner);
});
