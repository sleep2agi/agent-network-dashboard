// Browser regression for department-disc hover, picking, and selection feedback.
// Use only a local test server: Hub responses are synthetic browser fixtures.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:3112';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local test server');
const output = process.env.SCREENSHOT_DIR;
assert(output, 'Set SCREENSHOT_DIR for browser evidence');
await mkdir(output, { recursive: true });
const observe = process.argv.includes('--observe');
const theme = process.env.TEST_THEME || 'cyber';
const width = Number(process.env.TEST_WIDTH || 1440);
const names = ['ANet', 'TMAI', '设计协作', '开发平台', '知识库', '运行服务', '桌面客户端', '网关团队', '数据服务', '工具研发', '质量保障', '文档门户', '很长的部门名称用于阅读验证'];
const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i < 2 ? null : i < 7 ? 'd0' : 'd1', sort: i }));
const people = [0, 2, 3, 4, 6, 7, 10, 12].map((dept, i) => ({
  user_id: `u${i}`, username: `member${i}`, display_name: `测试成员 ${i + 1}`, role: 'member',
  department: { id: `d${dept}`, name: names[dept] },
  agents: Array.from({ length: i < 2 ? 14 : 13 }, (_, j) => ({ node_id: `n${i}-${j}`, alias: `Agent-${i}-${j}` })),
}));
const agents = people.flatMap(p => p.agents);
assert.equal(agents.length, 106);
const browser = await chromium.launch({ headless: true });
const checks = {};
try {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: true });
  const login = await context.request.post(`${base}/api/auth/login`, { data: { password: process.env.DASHBOARD_TEST_PASSWORD } });
  assert.equal(login.status(), 200, 'Local fixture login must succeed');
  await context.addInitScript(({ theme }) => {
    localStorage.setItem('anet-theme', theme);
    sessionStorage.setItem('anet_v3_auth', JSON.stringify({
      user: { username: 'fixture', role: 'owner' }, token: 'fixture-token',
      networks: [{ network_id: 'fixture', network_name: 'Fixture' }], currentNetwork: 'fixture',
    }));
    // Observe the rendered Canvas, without exposing production-only test hooks.
    const proto = CanvasRenderingContext2D.prototype;
    const shapes = new WeakMap();
    const target = ctx => ctx.canvas.getAttribute('aria-label') === '军团三维拓扑图';
    const wrap = (name, observe) => {
      const original = proto[name];
      proto[name] = function (...args) {
        if (target(this)) observe(this, args);
        return original.apply(this, args);
      };
    };
    wrap('setTransform', (_ctx, args) => {
      if (args.length === 6 && args.join(',') === '1,0,0,1,0,0') window.__legionFrame = { discs: [], strokes: [], labels: [] };
    });
    wrap('beginPath', ctx => shapes.delete(ctx));
    wrap('ellipse', (ctx, [x, y, rx, ry]) => shapes.set(ctx, { x, y, rx, ry }));
    wrap('fill', ctx => {
      const disc = shapes.get(ctx);
      if (disc) window.__legionFrame.discs.push(disc);
    });
    wrap('stroke', ctx => {
      const disc = shapes.get(ctx);
      if (disc) window.__legionFrame.strokes.push({ ...disc, color: ctx.strokeStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth });
    });
    wrap('fillText', (ctx, [text, x, y]) => window.__legionFrame.labels.push({ text, x, y, alpha: ctx.globalAlpha }));
  }, { theme });
  await context.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = pathname === '/api/hub/departments' ? { ok: true, departments, members: people.map(p => ({ user_id: p.user_id, department_id: p.department.id })) }
      : pathname === '/api/hub/people' ? { ok: true, total: people.length, people, agents_without_owner: [], has_more: false }
        : pathname === '/api/hub/status' ? { ok: true, sessions: agents.map((a, i) => ({ ...a, status: i % 10 === 0 ? 'working' : 'idle' })) }
          : pathname === '/api/hub/nodes' ? { ok: true, nodes: agents }
            : pathname === '/api/hub/health' ? { ok: true, version: 'fixture', sessions: agents.length, sse_sessions: {} }
              : { ok: true };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/legion/3d`, { waitUntil: 'networkidle' });
  await page.getByText('13 个部门 · 8 名成员 · 106 个 Agent', { exact: true }).waitFor();
  const spin = page.getByTestId('legion-3d-spin');
  if (await spin.getAttribute('aria-pressed') === 'true') await spin.click();
  await page.waitForFunction(() => window.__legionFrame?.discs.length === 13);
  const canvas = page.getByRole('img', { name: '军团三维拓扑图', exact: true });
  const box = await canvas.boundingBox();
  const frame = await page.evaluate(() => window.__legionFrame);
  // Pick an isolated disc in the lower part of the department ring, away from tools.
  const disc = [...frame.discs].sort((a, b) => b.y - a.y)[0];
  const point = { x: box.x + disc.x, y: box.y + disc.y };
  await page.screenshot({ path: path.join(output, `${theme}-${width}-default.png`) });
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  checks.hoverCursor = await canvas.evaluate(el => getComputedStyle(el).cursor) === 'pointer';
  checks.hoverOutline = await page.evaluate(d => window.__legionFrame.strokes.some(s => Math.abs(s.x - d.x) < 1 && Math.abs(s.y - d.y) < 1 && s.rx > d.rx + 2), disc);
  await page.screenshot({ path: path.join(output, `${theme}-${width}-hover.png`) });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: '关闭详情', exact: true }).waitFor();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  checks.selectionOutline = await page.evaluate(d => window.__legionFrame.strokes.some(s => Math.abs(s.x - d.x) < 1 && Math.abs(s.y - d.y) < 1 && s.rx > d.rx + 2), disc);
  await page.screenshot({ path: path.join(output, `${theme}-${width}-selected.png`) });
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  // A visible horizontal edge beyond the old fixed 16px picking circle.
  const edge = { x: point.x + disc.rx * 0.9, y: point.y };
  await page.mouse.click(edge.x, edge.y);
  checks.discEdgePicked = await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible();
  if (checks.discEdgePicked) await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByTestId('legion-3d-search').fill('ANet');
  await page.waitForTimeout(200);
  const labels = await page.evaluate(() => window.__legionFrame.labels);
  checks.unmatchedDepartmentDimmed = labels.some(l => names.includes(l.text) && l.text !== 'ANet' && l.alpha <= 0.36);
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.getByTestId('legion-3d-search').fill('');
  await page.touchscreen.tap(edge.x, edge.y);
  checks.touchEdgePicked = await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible();
  if (checks.touchEdgePicked) await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  checks.cancelDoesNotSelect = !(await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible());
  await cdp.detach();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  checks.dragCursor = await canvas.evaluate(el => getComputedStyle(el).cursor) === 'grabbing';
  await page.mouse.move(point.x + 70, point.y + 20, { steps: 5 });
  await page.mouse.up();
  checks.dragDoesNotSelect = !(await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible());
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.waitForTimeout(200);
  const movingDisc = await page.evaluate(() => [...window.__legionFrame.discs].sort((a, b) => b.y - a.y)[0]);
  await page.mouse.move(box.x + movingDisc.x, box.y + movingDisc.y);
  await page.getByTestId('legion-3d-stage').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  checks.hoverTracksCamera = await page.evaluate(p => window.__legionFrame.strokes
    .filter(s => s.lineWidth === 1 && Math.abs(s.alpha - 0.55) < 0.01)
    .every(s => ((s.x - p.x) / Math.max(18, s.rx - 5)) ** 2 + ((s.y - p.y) / Math.max(18, s.ry - 5)) ** 2 <= 1), movingDisc);
  // Return to the isolated disc: rotation may occlude it with a nearer node.
  await page.getByRole('button', { name: '重置视角', exact: true }).click();
  await page.waitForTimeout(200);
  // Double-click uses the same picking geometry as hover and selection.
  const latest = await page.evaluate(() => [...window.__legionFrame.discs].sort((a, b) => b.y - a.y)[0]);
  await page.mouse.dblclick(box.x + latest.x + latest.rx * 0.9, box.y + latest.y);
  await page.waitForURL('**/org', { waitUntil: 'domcontentloaded' });
  checks.discEdgeDoubleClick = true;
  await page.goto(`${base}/legion`, { waitUntil: 'networkidle' });
  checks.twoDRoute = await page.getByRole('heading', { name: 'Legion', exact: true }).isVisible();
  checks.noPageErrors = errors.length === 0;
  await writeFile(path.join(output, `${theme}-${width}-checks.json`), JSON.stringify({ fixture: { departments: 13, people: 8, agents: 106 }, disc, checks, errors }, null, 2));
  console.log(JSON.stringify({ theme, width, checks, errors }, null, 2));
  if (!observe) for (const [name, pass] of Object.entries(checks)) assert(pass, name);
} finally {
  await browser.close();
}
