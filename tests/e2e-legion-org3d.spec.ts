import { expect, test, type Page } from '@playwright/test';
import http from 'node:http';

/**
 * 组织 3D（`/legion/org`）的浏览器级契约，生产量级夹具：14 个部门、9 个人、340 个 Agent。
 *
 * 画布内容截图难断言，所以页面把可测的数字挂在 canvas 的 data-* 上：
 *   data-depts / data-people / data-agents —— 场景里真的有这么多实体；
 *   data-labels / data-forced —— 放下了多少标签、多少是「放不下只能叠着画」的（必须为 0）。
 * 进程内 stub Hub（`COMMHUB_URL` 见 playwright.config.ts），不连生产。
 * 与 e2e-legion-presentation 共用 9999 端口，workflow 里分两步串行跑。
 */

const NETWORK = 'net_fixture';
const names = ['ANet', '通信', 'TMWork', 'TM知识库', 'TM门户', 'TM基建', 'OODA', 'TMAI', '设计', '测试', '运维', '数据', '客户端', '研究'];
const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i === 0 ? null : i < 6 ? 'd0' : i < 10 ? 'd1' : i < 12 ? 'd2' : null, sort: i }));
const counts = [96, 52, 40, 30, 22, 16, 12, 8, 4];
const home = [0, 1, 1, 2, 2, 3, 6, 7, 1];
const statuses = ['working', 'idle', 'blocked', 'error'];
let n = 0;
const sessions: { alias: string; node_id: string; network_id: string; status: string }[] = [];
const agent = (prefix: string, dept: string | null) => {
  const node_id = `n${n++}`;
  const alias = `${prefix}-${n}`;
  if (n % 5) sessions.push({ alias, node_id, network_id: NETWORK, status: statuses[n % statuses.length] });
  return { node_id, alias, department_id: dept };
};
const people = counts.map((c, i) => ({
  user_id: `u${i}`, username: `user${i}`, display_name: `成员${i}`, role: 'member',
  department: { id: `d${home[i]}`, name: names[home[i]] },
  agents: Array.from({ length: c }, (_, k) => agent(`成员${i}`, k % 9 === 4 ? `d${(i * 3 + k) % 14}` : `d${home[i]}`)),
}));
const members = people.map((p, i) => ({ user_id: p.user_id, department_id: `d${home[i]}` }));
const orphans = Array.from({ length: 60 }, () => agent('野生', null));

test.use({ viewport: { width: 1440, height: 900 } });

let server: http.Server;
let sessionCookies: Array<{ name: string; value: string; domain: string; path: string }> = [];

test.beforeAll(async ({ request }) => {
  const login = await request.post('/api/auth/login', { data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' } });
  expect(login.status(), await login.text()).toBe(200);
  sessionCookies = (await request.storageState()).cookies;
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:9999');
    const json = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/requirements/people/directory') {
      return json({ ok: true, total: people.length, people, agents_without_owner: orphans, has_more: false, agent_department_supported: true });
    }
    if (url.pathname.endsWith('/departments')) return json({ ok: true, departments, members });
    if (url.pathname === '/api/status') return json({ ok: true, sessions });
    if (url.pathname === '/api/networks') return json({ ok: true, networks: [{ network_id: NETWORK, network_name: '组织夹具', role: 'owner' }] });
    return json({ ok: true, networks: [], sessions: [], nodes: [], tasks: [], messages: [], stats: {}, version: 'fixture' });
  });
  await new Promise<void>(resolve => server.listen(9999, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  if (!server) return;
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test.beforeEach(async ({ context }) => {
  await context.addCookies(sessionCookies);
  await context.addInitScript(network => sessionStorage.setItem('anet_network_id', network), NETWORK);
});

async function open(page: Page) {
  await page.goto('/legion/org', { waitUntil: 'domcontentloaded' });
  const canvas = page.getByTestId('org3d-canvas');
  await expect(canvas).toHaveAttribute('data-agents', '340', { timeout: 30000 });
  await expect(canvas).toHaveAttribute('data-labels', /\d+/);
  return canvas;
}

test('renders the whole org with every department and person label readable', async ({ page }) => {
  const canvas = await open(page);
  await expect(canvas).toHaveAttribute('data-people', '9');
  await expect(canvas).toHaveAttribute('data-depts', '15');
  await expect(canvas).toHaveAttribute('data-forced', '0');
  expect(Number(await canvas.getAttribute('data-labels'))).toBeGreaterThanOrEqual(15 + 9);
  await expect(page.getByTestId('org3d-counts')).toHaveText('15 个部门 · 9 名成员 · 340 个 Agent');
  const box = await canvas.boundingBox();
  expect(box!.height).toBeGreaterThan(500);
  expect(box!.height).toBeLessThan(900);
});

test('details, search focus, hover tooltip and status filter', async ({ page }) => {
  const canvas = await open(page);
  await page.getByTestId('org3d-details').getByRole('button', { name: /^OODA/ }).click();
  await expect(page.getByTestId('org3d-details')).toHaveAttribute('data-kind', 'dept');
  await expect(page.getByTestId('org3d-details').getByRole('heading', { level: 2 })).toHaveText('OODA');

  await page.getByTestId('org3d-search').fill('成员0');
  await expect(page.getByTestId('org3d-search-results')).toContainText('成员');
  await page.getByTestId('org3d-search').press('Enter');
  const details = page.getByTestId('org3d-details');
  await expect(details).toHaveAttribute('data-kind', 'person');
  await expect(details).toContainText('96 个');
  await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1.5);
  await expect.poll(async () => Number(await canvas.getAttribute('data-agent-labels'))).toBeGreaterThan(0);

  const box = (await canvas.boundingBox())!;
  let tooltip = '';
  for (let dy = -120; dy <= 40 && !tooltip; dy += 8) {
    for (let dx = -40; dx <= 40 && !tooltip; dx += 8) {
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      if (await page.getByTestId('org3d-tooltip').count()) tooltip = await page.getByTestId('org3d-tooltip').innerText();
    }
  }
  expect(tooltip).not.toBe('');

  const working = page.getByTestId('org3d-legend').getByRole('button', { name: /^运行中/ });
  await working.click();
  await expect(working).toHaveAttribute('aria-pressed', 'true');
  await canvas.focus();
  await page.keyboard.press('Escape');
  await expect(working).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('org3d-clear')).toHaveCount(0);
});

test('a failed directory read is an error with retry, never an empty org', async ({ page }) => {
  await page.route('**/api/hub/people**', route => route.fulfill({ status: 500, json: { ok: false, error: 'hub_down' } }));
  await page.goto('/legion/org', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert').filter({ hasText: '读取军团编制失败' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(page.getByTestId('org3d-empty')).toHaveCount(0);
});
