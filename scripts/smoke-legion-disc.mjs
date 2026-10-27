// Browser regression for department-disc hover, picking, and selection feedback.
// Use only a local test server: Hub responses are synthetic browser fixtures.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const dense = process.env.TEST_DENSE === '1';
const longName = process.env.TEST_LONG_LABEL === '1';
const prefix = `${dense ? 'dense-' : ''}${longName ? 'long-' : ''}${theme}-${width}`;
const names = ['ANet', 'TMAI', '设计协作', '开发平台', '知识库', '运行服务', '桌面客户端', '网关团队', '数据服务', '工具研发', '质量保障', '文档门户', '很长的部门名称用于阅读验证'];
if (dense) names.push(...Array.from({ length: 11 }, (_, i) => `协作部门 ${i + 1}`));
if (longName) names[names.length - 1] = '超长部门名称完整展示与多行排版阅读验证不能截断';
const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i < 2 ? null : i < 7 ? 'd0' : 'd1', sort: i }));
const memberDepartments = dense ? Array.from({ length: 16 }, (_, i) => i + 2) : [0, 2, 3, 4, 6, 7, 10, 12];
const people = memberDepartments.map((dept, i) => ({
  user_id: `u${i}`, username: `member${i}`, display_name: `测试成员 ${i + 1}`, role: 'member',
  department: { id: `d${dept}`, name: names[dept] },
  agents: Array.from({ length: dense ? 20 : i < 2 ? 14 : 13 }, (_, j) => ({ node_id: `n${i}-${j}`, alias: `Agent-${i}-${j}` })),
}));
const agents = people.flatMap(p => p.agents);
assert.equal(agents.length, dense ? 320 : 106);
const browser = await chromium.launch({ headless: true });
const checks = {};
try {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', hasTouch: true });
  assert(process.env.DASHBOARD_TEST_PASSWORD, 'Set the local fixture server password');
  // This tests rendering, not login. Seed the local-only fixture cookie so a
  // viewport matrix does not consume the real login endpoint's rate limit.
  await context.addCookies([{ name: 'anet_dashboard_session', url: base, httpOnly: true, sameSite: 'Lax',
    value: createHash('sha256').update(`anet-dashboard:${process.env.DASHBOARD_TEST_PASSWORD}`).digest('hex') }]);
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
      if (args.length === 6 && args.join(',') === '1,0,0,1,0,0') window.__legionFrame = { discs: [], strokes: [], circles: [], labels: [], leaders: [] };
    });
    wrap('beginPath', ctx => shapes.delete(ctx));
    wrap('ellipse', (ctx, [x, y, rx, ry]) => shapes.set(ctx, { kind: 'disc', x, y, rx, ry }));
    wrap('arc', (ctx, [x, y, radius]) => shapes.set(ctx, { kind: 'circle', x, y, rx: radius, ry: radius }));
    wrap('moveTo', (ctx, [x, y]) => shapes.set(ctx, { kind: 'line', from: { x, y } }));
    wrap('lineTo', (ctx, [x, y]) => { const shape = shapes.get(ctx); if (shape?.kind === 'line') shape.to = { x, y }; });
    wrap('fill', ctx => {
      const disc = shapes.get(ctx);
      if (disc?.kind === 'disc') window.__legionFrame.discs.push(disc);
    });
    wrap('stroke', ctx => {
      const disc = shapes.get(ctx);
      if (disc?.kind === 'disc') window.__legionFrame.strokes.push({ ...disc, color: ctx.strokeStyle, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth });
      if (disc?.kind === 'circle') window.__legionFrame.circles.push({ ...disc, color: ctx.strokeStyle, lineWidth: ctx.lineWidth });
      if (disc?.kind === 'line' && disc.to && ctx.lineWidth === 0.75) window.__legionFrame.leaders.push(disc);
    });
    wrap('fillText', (ctx, [text, x, y]) => {
      const metrics = ctx.measureText(text);
      window.__legionFrame.labels.push({ text, x, y, alpha: ctx.globalAlpha,
        x1: x - metrics.actualBoundingBoxLeft, x2: x + metrics.actualBoundingBoxRight,
        y1: y - metrics.actualBoundingBoxAscent, y2: y + metrics.actualBoundingBoxDescent });
    });
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
  await page.getByText(`${departments.length} 个部门 · ${people.length} 名成员 · ${agents.length} 个 Agent`, { exact: true }).waitFor();
  const spin = page.getByTestId('legion-3d-spin');
  if (await spin.getAttribute('aria-pressed') === 'true') await spin.click();
  await page.waitForFunction(count => window.__legionFrame?.discs.length === count, departments.length);
  const canvas = page.getByRole('img', { name: '军团三维拓扑图', exact: true });
  const box = await canvas.boundingBox();
  const frame = await page.evaluate(() => window.__legionFrame);
  const core = [...frame.circles].sort((a, b) => b.rx - a.rx)[0];
  assert(core, 'Fixture must render the core');
  const overlaps = (label, shape) => {
    const x = Math.max(label.x1, Math.min(shape.x, label.x2));
    const y = Math.max(label.y1, Math.min(shape.y, label.y2));
    return ((x - shape.x) / shape.rx) ** 2 + ((y - shape.y) / shape.ry) ** 2 < 1;
  };
  checks.labelsClearCore = frame.labels.every(label => !overlaps(label, core));
  checks.labelsClearDepartments = frame.labels.every(label => frame.discs.every(d => !overlaps(label, d)));
  checks.labelsInsideCanvas = frame.labels.every(label => label.x1 >= 0 && label.y1 >= 0 && label.x2 <= box.width && label.y2 <= box.height);
  const header = await page.locator('div.pointer-events-none.absolute').filter({ has: page.getByTestId('legion-3d-search') }).boundingBox();
  checks.labelsClearControls = frame.labels.every(label => label.x2 < header.x - box.x || label.x1 > header.x - box.x + header.width
    || label.y2 < header.y - box.y || label.y1 > header.y - box.y + header.height);
  checks.coreLabelVisible = frame.labels.some(label => label.text === '军团');
  const personColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fg').trim().toLowerCase());
  // In this fixture every member uses --fg, while Agents use --fg-muted or
  // --success. Ignore the thinner selection outline rather than guessing sizes.
  const personBodies = data => data.circles.filter(circle => circle.color === personColor && circle.lineWidth >= 1.39);
  checks.personBodiesIdentified = personBodies(frame).length === people.length;
  const verifyClearance = async () => {
    const current = await page.evaluate(() => window.__legionFrame);
    const coreBody = [...current.circles].sort((a, b) => b.rx - a.rx)[0];
    const controls = page.locator('div.pointer-events-none.absolute').filter({ has: page.getByTestId('legion-3d-search') });
    const rect = await controls.isVisible() ? await controls.boundingBox() : null;
    const reserved = rect ? [{ x1: rect.x - box.x, x2: rect.x - box.x + rect.width, y1: rect.y - box.y, y2: rect.y - box.y + rect.height }] : [];
    const bodies = [...current.discs, coreBody, ...personBodies(current)];
    if (!coreBody || current.labels.length === 0) return false;
    const clearText = current.labels.every(label => label.x1 >= 0 && label.y1 >= 0 && label.x2 <= box.width && label.y2 <= box.height
      && bodies.every(body => !overlaps(label, body))
      && reserved.every(r => label.x2 < r.x1 || label.x1 > r.x2 || label.y2 < r.y1 || label.y1 > r.y2));
    // Independent sampled geometry oracle for leaders, including later labels.
    const clearLeaders = current.leaders.every(line => {
      const steps = Math.ceil(Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y));
      for (let i = 0; i <= steps; i++) {
        const x = line.from.x + (line.to.x - line.from.x) * i / steps;
        const y = line.from.y + (line.to.y - line.from.y) * i / steps;
        if ([...reserved, ...current.labels].some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2)) return false;
        if (bodies.some(b => ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 < 1)) return false;
      }
      return true;
    });
    return clearText && clearLeaders;
  };
  checks.initialLeaderClearance = await verifyClearance();
  // Pick an isolated disc in the lower part of the department ring, away from tools.
  const disc = [...frame.discs].sort((a, b) => b.y - a.y)[0];
  const point = { x: box.x + disc.x, y: box.y + disc.y };
  await page.screenshot({ path: path.join(output, `${prefix}-default.png`) });
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  checks.hoverCursor = await canvas.evaluate(el => getComputedStyle(el).cursor) === 'pointer';
  checks.hoverOutline = await page.evaluate(d => window.__legionFrame.strokes.some(s => Math.abs(s.x - d.x) < 1 && Math.abs(s.y - d.y) < 1 && s.rx > d.rx + 2), disc);
  await page.screenshot({ path: path.join(output, `${prefix}-hover.png`) });
  await page.mouse.click(point.x, point.y);
  await page.getByRole('button', { name: '关闭详情', exact: true }).waitFor();
  await page.mouse.move(10, 10);
  await page.waitForTimeout(100);
  checks.selectionOutline = await page.evaluate(d => window.__legionFrame.strokes.some(s => Math.abs(s.x - d.x) < 1 && Math.abs(s.y - d.y) < 1 && s.rx > d.rx + 2), disc);
  checks.selectedClearance = await verifyClearance();
  await page.screenshot({ path: path.join(output, `${prefix}-selected.png`) });
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
  checks.rotatedClearance = await verifyClearance();
  await page.keyboard.press('+');
  await page.waitForTimeout(200);
  checks.zoomedClearance = await verifyClearance();
  await page.getByTestId('legion-3d-clean').click();
  await page.waitForTimeout(100);
  checks.cleanViewClearance = await verifyClearance();
  await page.getByTestId('legion-3d-stage').press('Escape');
  await page.waitForTimeout(100);
  checks.restoredControlsClearance = await verifyClearance();
  if (longName) {
    // A cramped Canvas may omit a label. The full name must always be readable
    // in details; a wide viewport must also show the wrapped Canvas name.
    await page.getByTestId('legion-3d-list-toggle').click();
    await page.getByRole('option').filter({ hasText: names[names.length - 1] }).click();
    if (width >= 640) await page.waitForFunction(name => window.__legionFrame.labels.map(label => label.text).join('').includes(name), names[names.length - 1], { timeout: 4000 }).catch(async error => {
      await page.screenshot({ path: path.join(output, `${prefix}-failure.png`) });
      await writeFile(path.join(output, `${prefix}-failure.json`), JSON.stringify(await page.evaluate(() => window.__legionFrame), null, 2));
      throw error;
    });
    const title = page.getByTestId('legion-3d-detail').getByText(names[names.length - 1], { exact: true });
    checks.longNameUncut = await title.isVisible() && await title.evaluate(el => {
      const style = getComputedStyle(el);
      return style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'nowrap' && el.scrollWidth <= el.clientWidth;
    });
    checks.longNameSelectionClearance = await verifyClearance();
    await page.screenshot({ path: path.join(output, `${prefix}-full-name.png`) });
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    if (await page.getByTestId('legion-3d-list-toggle').getAttribute('aria-expanded') === 'true') await page.getByTestId('legion-3d-list-toggle').click();
  }
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
  await writeFile(path.join(output, `${prefix}-checks.json`), JSON.stringify({ fixture: { departments: departments.length, people: people.length, agents: agents.length }, disc, checks, errors, initialFrame: frame, header, canvas: box }, null, 2));
  console.log(JSON.stringify({ theme, width, dense, longName, checks, errors }, null, 2));
  if (!observe) for (const [name, pass] of Object.entries(checks)) assert(pass, name);
} finally {
  await browser.close();
}
