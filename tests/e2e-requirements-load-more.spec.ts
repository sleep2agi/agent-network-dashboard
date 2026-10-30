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
  mode: 'normal' as 'normal' | 'empty' | 'error' | 'unauthorized',
  requests: [] as string[],
  replaceDelay: 100,
  appendDelay: 1200,
  reset(delays: { replace?: number; append?: number } = {}) {
    this.mode = 'normal';
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
      if (hub.mode === 'unauthorized') {
        setTimeout(() => {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
        }, delay);
        return;
      }
      if (hub.mode === 'error') {
        setTimeout(() => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'hub_unavailable' }));
        }, delay);
        return;
      }
      if (hub.mode === 'empty') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, requirements: [], has_more: false, next_cursor: null }));
        }, delay);
        return;
      }
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
    // 组织架构页的代理实际打的是 /api/requirements/people/directory（见 app/api/hub/people/route.ts）。
    if (url.pathname === '/api/requirements/people/directory') {
      hub.requests.push(url.search);
      res.writeHead(hub.mode === 'unauthorized' ? 401 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(hub.mode === 'unauthorized'
        ? { ok: false, error: 'unauthorized' }
        : { ok: true, people: [], has_more: false, next_offset: null, agents_without_owner: [], total: 0 }));
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
  // /requirements 现在要等网络解析完成才发请求；测试 Hub 不提供 /api/networks，
  // 所以像其它 Playwright 脚本一样先把选区写进 sessionStorage。
  await context.addInitScript(() => sessionStorage.setItem('anet_network_id', 'fixture'));
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

// ---- 状态面：空 / 401 / 500+重试（截图留档，不画“已通过”的假绿） ----

const SHOT_DIR = '/tmp/opencode/dash-repro/shots/states';

async function shot(page: import('@playwright/test').Page, name: string, width: number) {
  // 改视口后必须重新加载再拍：侧栏有 translate 过渡，立刻抓帧会拍到滑出动画的中间态
  // （会看成“正文被侧栏压住”的假缺陷）。reload + 等一拍才是稳定布局。
  await page.setViewportSize({ width, height: width < 500 ? 812 : 900 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  // 拍图前顺手断一次：正文左边界不得被侧栏（off-canvas 时为负 x）压住。
  const box = await page.locator('h1').first().boundingBox();
  expect(box?.x ?? 0).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: `${SHOT_DIR}/${name}-${width}.png`, fullPage: true });
}

test('空态：无筛选时是「需求池是空的」，筛选无结果时给清筛选入口', async ({ page }) => {
  hub.mode = 'empty';
  await page.goto('/requirements');
  await expect(page.getByText('需求池是空的')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  hub.mode = 'normal';
  await page.goto('/requirements?status=abandoned');
  await expect(page.locator('ul li')).toHaveCount(1); // stub：带 status 只回 doing 一行
  hub.mode = 'empty';
  await page.goto('/requirements?status=abandoned');
  await expect(page.getByText('没有符合筛选的需求')).toBeVisible();
  await expect(page.getByRole('button', { name: '清空筛选' })).toBeVisible();
  await shot(page, 'empty-filtered', 375);
  await shot(page, 'empty-filtered', 1280);
});

test('401：给「会话已过期」与重新登录入口，不显示成空列表', async ({ page }) => {
  hub.mode = 'unauthorized';
  await page.goto('/requirements');
  await expect(page.getByText(/会话已过期/)).toBeVisible();
  await expect(page.getByText('需求池是空的')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '重新登录' })).toBeVisible();
  await shot(page, 'unauthorized', 375);
  await shot(page, 'unauthorized', 1280);
});

test('500：错误可见，重试能真的把列表拉回来（追加失败后同样走重试）', async ({ page }) => {
  hub.mode = 'error';
  await page.goto('/requirements');
  await expect(page.getByText(/读取失败：hub_unavailable/)).toBeVisible();
  await expect(page.getByText('需求池是空的')).toHaveCount(0);
  await shot(page, 'error', 375);

  hub.mode = 'normal';
  hub.requests = [];
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('ul li')).toHaveCount(3);
  expect(hub.requests).toHaveLength(1);
  expect(hub.requests[0]).not.toContain('cursor=');
});

test('追加失败：列表保留、按钮回到可重试，重试带 cursor 且不重复发', async ({ page }) => {
  await page.goto('/requirements');
  await expect(page.locator('ul li')).toHaveCount(3);

  hub.mode = 'error';
  hub.requests = [];
  await page.getByRole('button', { name: /加载更多/ }).click();
  await expect(page.getByText(/读取失败：hub_unavailable/)).toBeVisible();
  // 失败不能把已加载的 3 行清掉。
  await expect(page.locator('ul li')).toHaveCount(3);

  hub.mode = 'normal';
  hub.replaceDelay = 100;
  hub.requests = []; // 只数重试这一枪，不含刚才故意失败的那次
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('ul li')).toHaveCount(5, { timeout: 10000 });
  expect(hub.requests.filter((q) => q.includes('cursor=c2'))).toHaveLength(1);
});

test('组织架构页：401 时说「会话已过期」，不能说成通讯录为空；真空白时仍要有空态', async ({ page }) => {
  hub.mode = 'unauthorized';
  await page.goto('/org');
  await expect(page.getByText(/会话已过期/)).toBeVisible();
  await expect(page.getByText('通讯录是空的')).toHaveCount(0);

  hub.mode = 'normal';
  await page.goto('/org');
  await expect(page.getByText('通讯录是空的')).toBeVisible();
});
