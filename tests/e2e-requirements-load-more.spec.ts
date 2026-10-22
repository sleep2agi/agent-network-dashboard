import { expect, test } from '@playwright/test';
import http from 'node:http';

/**
 * #1636 — 需求列表加载状态。
 *
 * 两件事在这里被浏览器证明，因为两者都是渲染/竞态，源码字符串检查测不出来：
 *   1. 「加载更多」期间已加载的行不能被骨架屏顶掉；
 *   2. 替换（刷新/换筛选）在飞时，追加不得发网络请求，也不得拿旧 cursor 打新筛选；
 *      旧请求的迟到回包不得混进新列表；同一页重复点击只发一次。
 *
 * 用进程内 stub Hub（COMMHUB_URL 默认 http://localhost:9999，见 playwright.config.ts），
 * 不连生产、不读真实数据；延迟由测试控制，让「在飞」成为可观测窗口。
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
const DOING_ROWS = [{ id: 'req_doing', seq: 201, name: 'doing only', column: 'doing', priority: 'normal', tags: ['ANet'] }];

const hub = {
  requests: [] as string[],
  replaceDelay: 100,
  appendDelay: 1200,
  reset(delays: { replace?: number; append?: number } = {}) {
    this.requests = [];
    this.replaceDelay = delays.replace ?? 100;
    this.appendDelay = delays.append ?? 1200;
  },
};

let server: http.Server;

// 每个 test 重新登录会撞上 Hub 的登录限流（10 次 / 15 分钟）：一次登录、复用 cookie。
let sessionCookies: Array<{ name: string; value: string; domain: string; path: string }> = [];

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  expect(login.status(), await login.text()).toBe(200);
  sessionCookies = (await request.storageState()).cookies;
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:9999');
    if (url.pathname === '/api/requirements') {
      const cursor = url.searchParams.get('cursor');
      const status = url.searchParams.get('status') || '';
      hub.requests.push(url.search);
      const delay = cursor ? hub.appendDelay : hub.replaceDelay;
      const body = cursor
        ? { ok: true, requirements: PAGE2, has_more: false, next_cursor: null }
        : status
          ? { ok: true, requirements: DOING_ROWS, has_more: false, next_cursor: null }
          : { ok: true, requirements: ROWS, has_more: true, next_cursor: 'c2' };
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delay);
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

test.beforeEach(async ({ context }) => {
  await context.addCookies(sessionCookies);
  hub.reset();
});

test('加载更多期间已加载的行留在屏幕上，追加完才变成 5 行', async ({ page }) => {
  hub.reset({ append: 3000 });
  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  await page.getByRole('button', { name: /加载更多/ }).click();
  await expect(page.getByRole('button', { name: /加载中/ })).toBeVisible();
  // 追加在飞：短超时断言当下这一刻，旧实现这里是 0 行。
  await expect(page.locator('ul li')).toHaveCount(3, { timeout: 600 });
  await expect(page.locator('.animate-pulse')).toHaveCount(0);

  await expect(page.locator('ul li')).toHaveCount(5, { timeout: 10000 });
});

test('替换在飞时：按钮不可追加，不发 cursor 请求，也不把骨架屏换回旧行', async ({ page }) => {
  hub.reset({ replace: 1500 });
  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  hub.reset({ replace: 1500 });
  await page.getByRole('button', { name: '进行中' }).click();

  // 替换在飞：骨架屏必须还在（旧实现 append start 会把 loading 置 false 并显示旧行）。
  await expect(page.locator('.animate-pulse')).toHaveCount(8, { timeout: 700 });
  // 「加载更多」此期间不得可点（不在或 disabled 都算合格，enabled 就是回归）。
  const more = page.getByRole('button', { name: /加载更多/ });
  const moreCount = await more.count();
  const moreDisabled = moreCount === 0 ? true : await more.first().isDisabled();
  // 就算被强行点到，也不能带着旧 cursor 打新筛选 —— 先查网络，再查按钮态。
  if (moreCount > 0) await more.first().click({ force: true, timeout: 500 }).catch(() => {});
  await page.waitForTimeout(300);
  expect(hub.requests.filter((q) => q.includes('cursor='))).toHaveLength(0);
  expect({ moreCount, moreDisabled }).toEqual({ moreCount, moreDisabled: true });

  await expect(page.locator('ul li')).toHaveCount(1, { timeout: 5000 });
});

test('旧筛选的追加迟到回包不得混进新列表', async ({ page }) => {
  hub.reset({ append: 1800 });
  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  // 1) 旧筛选（全部）上发起追加，回包要 1.8s 才到。
  await page.getByRole('button', { name: /加载更多/ }).click();
  await expect(page.getByRole('button', { name: /加载中/ })).toBeVisible();

  // 2) 追加在飞时换筛选：替换 100ms 就回。
  hub.replaceDelay = 100;
  await page.getByRole('button', { name: '进行中' }).click();
  await expect(page.locator('ul li')).toHaveCount(1);

  // 3) 旧追加迟到落地：列表必须仍是新筛选的结果，不能变成 5 行或混入旧行。
  await page.waitForTimeout(2000);
  await expect(page.locator('ul li')).toHaveCount(1);
  await expect(page.locator('ul li')).toHaveText([/doing only/]);
});

test('同一页重复点击只发一次请求', async ({ page }) => {
  hub.reset({ append: 1200 });
  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  const more = page.getByRole('button', { name: /加载更多/ });
  // 先取坐标：点下去之后按钮文案会变成「加载中…」，locator 就再也匹配不到了。
  const box = await more.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(300);

  expect(hub.requests.filter((q) => q.includes('cursor=c2'))).toHaveLength(1);
  await expect(page.locator('ul li')).toHaveCount(5, { timeout: 10000 });
});

test('376px 窄屏下需求列表不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/requirements');
  await expect(page.locator('ul li').first()).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.inner);
});
