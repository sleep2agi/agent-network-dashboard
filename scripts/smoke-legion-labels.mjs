// Local-only rendering regression for the deployed circular/portrait renderer.
// Synthetic identity/data: this is not a real-user login or production-data test.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL || 'http://127.0.0.1:3114';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a local fixture server');
assert(process.env.DASHBOARD_TEST_PASSWORD, 'Set the local fixture password');
const output = process.env.SCREENSHOT_DIR;
assert(output, 'Set SCREENSHOT_DIR for evidence');
await mkdir(output, { recursive: true });
const theme = process.env.TEST_THEME || 'cyber';
const width = Number(process.env.TEST_WIDTH || 1440);
const dense = process.env.TEST_DENSE === '1';
const clustered = process.env.TEST_CLUSTERED === '1';
const longName = '超长部门名称完整展示与多行排版阅读验证不能截断';
const names = ['ANet', 'TMAI', '设计协作', '开发平台', '知识库', '运行服务', '桌面客户端', '网关团队', '数据服务', '工具研发', '质量保障', '文档门户', longName];
if (dense) names.push(...Array.from({ length: 11 }, (_, i) => `协作部门 ${i + 1}`));
const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i < 2 ? null : i < 7 ? 'd0' : 'd1', sort: i }));
const memberDepartments = dense ? Array.from({ length: 16 }, (_, i) => i + 2) : [0, 2, 3, 4, 6, 7, 10, 12];
const people = memberDepartments.map((department, i) => ({
  user_id: `u${i}`, username: `member${i}`, display_name: `测试成员 ${i + 1}`, role: 'member',
  department: { id: `d${clustered ? 2 : department}`, name: names[clustered ? 2 : department] },
  agents: Array.from({ length: dense ? 20 : i < 2 ? 14 : 13 }, (_, j) => ({ node_id: `n${i}-${j}`, alias: `Agent-${i}-${j}` })),
}));
const agents = people.flatMap(person => person.agents);
const prefix = `${clustered ? 'clustered-' : dense ? 'dense-' : ''}${theme}-${width}`;
const browser = await chromium.launch({ headless: true });
const checks = {};
const frames = {};
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'anet_dashboard_session', url: base, httpOnly: true, sameSite: 'Lax',
    value: createHash('sha256').update(`anet-dashboard:${process.env.DASHBOARD_TEST_PASSWORD}`).digest('hex') }]);
  await context.addInitScript(theme => {
    localStorage.setItem('anet-theme', theme);
    sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-token',
      networks: [{ network_id: 'fixture', network_name: 'Fixture' }], currentNetwork: 'fixture' }));
    // Observe draw commands, without adding test hooks to product code.
    const proto = CanvasRenderingContext2D.prototype;
    const shapes = new WeakMap();
    const wrap = (name, fn) => {
      const original = proto[name];
      proto[name] = function (...args) {
        if (this.canvas.getAttribute('aria-label') === '军团三维拓扑图') fn(this, args);
        return original.apply(this, args);
      };
    };
    wrap('setTransform', (_ctx, args) => {
      if (args.join(',') === '1,0,0,1,0,0') window.__labelFrame = { circles: [], labels: [], glyphs: [], leaders: [], avatars: [] };
    });
    wrap('beginPath', ctx => shapes.delete(ctx));
    wrap('arc', (ctx, [x, y, r]) => shapes.set(ctx, { x, y, rx: r, ry: r }));
    wrap('moveTo', (ctx, [x, y]) => shapes.set(ctx, { from: { x, y } }));
    wrap('lineTo', (ctx, [x, y]) => { const s = shapes.get(ctx); if (s?.from) s.to = { x, y }; });
    wrap('stroke', ctx => {
      const s = shapes.get(ctx);
      if (s?.rx && ctx.lineWidth >= 1.39) window.__labelFrame.circles.push({ ...s, color: ctx.strokeStyle, alpha: ctx.globalAlpha });
      if (s?.to && ctx.lineWidth === 0.75) window.__labelFrame.leaders.push(s);
    });
    wrap('drawImage', (_ctx, [img, x, y, w, h]) => {
      if (img instanceof HTMLImageElement && img.src.includes('/avatars/label-fixture.svg')) window.__labelFrame.avatars.push({ x, y, w, h });
    });
    wrap('fillText', (ctx, [text, x, y]) => {
      if (ctx.textAlign !== 'center') return; // Existing pointer tooltip is a separate overlay.
      const metric = ctx.measureText(text);
      const entry = { text, x, y, alpha: ctx.globalAlpha,
        x1: x - metric.actualBoundingBoxLeft, x2: x + metric.actualBoundingBoxRight,
        y1: y - metric.actualBoundingBoxAscent, y2: y + metric.actualBoundingBoxDescent };
      const isInnerGlyph = ctx.font.startsWith('600 ') && text !== '军团';
      window.__labelFrame[isInnerGlyph ? 'glyphs' : 'labels'].push(entry);
    });
  }, theme);
  await context.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const json = url.pathname === '/api/hub/departments' ? { ok: true, departments, members: people.map(p => ({ user_id: p.user_id, department_id: p.department.id })) }
      : url.pathname === '/api/hub/people' ? { ok: true, network_id: 'fixture', people, total: people.length, has_more: false, agents_without_owner: [] }
        : url.pathname === '/api/hub/status' ? { ok: true, sessions: agents.map((a, i) => ({ ...a, status: i % 10 === 0 ? 'working' : 'idle' })) }
          : url.pathname === '/api/hub/nodes' ? { ok: true, nodes: agents }
            : url.pathname === '/api/hub/health' ? { ok: true, version: 'fixture', sessions: agents.length, sse_sessions: {} }
              : { ok: true };
    return route.fulfill({ json });
  });
  await context.route('**/avatars/manifest.json', route => route.fulfill({ json: Object.fromEntries(people.filter((_, i) => i % 2 === 0).map(p => [p.username, '/avatars/label-fixture.svg'])) }));
  await context.route('**/avatars/label-fixture.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#247876"/><circle cx="32" cy="25" r="12" fill="#e8eddf"/><path d="M8 64a24 24 0 0 1 48 0" fill="#e8eddf"/></svg>' }));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/legion/3d`, { waitUntil: 'networkidle' });
  await page.getByText(`${departments.length} 个部门 · ${people.length} 名成员 · ${agents.length} 个 Agent`, { exact: true }).waitFor();
  if (await page.getByTestId('legion-3d-spin').getAttribute('aria-pressed') === 'true') await page.getByTestId('legion-3d-spin').click();
  const colors = await page.evaluate(() => Object.fromEntries(['fg', 'info', 'accent'].map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim().toLowerCase()])));
  const canvas = page.getByRole('img', { name: '军团三维拓扑图', exact: true });
  const stage = page.getByTestId('legion-3d-stage');
  const header = page.locator('div.pointer-events-none.absolute').filter({ has: page.getByTestId('legion-3d-search') });
  // Accent-coloured 3px packets are not nodes; the core is the largest accent circle.
  const bodyCircles = frame => {
    const core = frame.circles.filter(circle => circle.color === colors.accent).sort((a, b) => b.rx - a.rx)[0];
    return [...frame.circles.filter(circle => circle.color === colors.fg || circle.color === colors.info), ...(core ? [core] : [])];
  };
  const capture = async name => {
    // Wait for the renderer's 180ms interaction downgrade to settle.
    await page.waitForTimeout(450);
    await page.waitForFunction(() => window.__labelFrame?.labels.length > 0);
    const frame = await page.evaluate(() => window.__labelFrame);
    const box = await canvas.boundingBox();
    const h = await header.isVisible() ? await header.boundingBox() : null;
    const reserved = h ? [{ x1: h.x - box.x, x2: h.x - box.x + h.width, y1: h.y - box.y, y2: h.y - box.y + h.height }] : [];
    const bodies = bodyCircles(frame);
    const overlap = (r, b) => ((Math.max(r.x1, Math.min(b.x, r.x2)) - b.x) / b.rx) ** 2
      + ((Math.max(r.y1, Math.min(b.y, r.y2)) - b.y) / b.ry) ** 2 < 1;
    checks[`${name}:bodiesObserved`] = bodies.length === departments.length + people.length + 1;
    checks[`${name}:textClearBodies`] = frame.labels.every(label => bodies.every(body => !overlap(label, body)));
    checks[`${name}:textClearHeader`] = frame.labels.every(label => reserved.every(r => label.x2 < r.x1 || label.x1 > r.x2 || label.y2 < r.y1 || label.y1 > r.y2));
    checks[`${name}:textInsideCanvas`] = frame.labels.every(label => label.x1 >= 0 && label.y1 >= 0 && label.x2 <= box.width && label.y2 <= box.height);
    checks[`${name}:leadersClear`] = frame.leaders.every(line => {
      const steps = Math.max(1, Math.ceil(Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y)));
      for (let i = 1; i < steps; i++) {
        const x = line.from.x + (line.to.x - line.from.x) * i / steps;
        const y = line.from.y + (line.to.y - line.from.y) * i / steps;
        if ([...reserved, ...frame.labels].some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2)) return false;
        if (bodies.some(b => ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 < 1)) return false;
      }
      return true;
    });
    frames[name] = { ...frame, box, reserved };
    return frame;
  };
  const initial = await capture('initial');
  checks.coreVisible = initial.labels.some(label => label.text === '军团');
  if (width >= 640) checks.portraitsPreserved = initial.avatars.length > 0;
  checks.emptyDepartmentsStillDrawn = initial.circles.filter(c => c.color === colors.info).length === departments.length;
  if (clustered) checks.emptyDepartmentsStillDim = initial.circles.some(c => c.color === colors.info && c.alpha < 0.31);
  await page.screenshot({ path: path.join(output, `${prefix}-default.png`) });
  await page.getByTestId('legion-3d-list-toggle').click();
  await page.getByRole('option').filter({ hasText: longName }).click();
  if (await page.getByTestId('legion-3d-list-toggle').getAttribute('aria-expanded') === 'true') await page.getByTestId('legion-3d-list-toggle').click();
  const selected = await capture('selected');
  const title = page.getByTestId('legion-3d-detail').getByText(longName, { exact: true });
  checks.longDetailUncut = await title.isVisible() && await title.evaluate(el => {
    const css = getComputedStyle(el);
    return css.textOverflow !== 'ellipsis' && css.whiteSpace !== 'nowrap' && el.scrollWidth <= el.clientWidth;
  });
  if (width >= 640) checks.fullCanvasName = selected.labels.map(label => label.text).join('').includes(longName);
  await page.screenshot({ path: path.join(output, `${prefix}-selected.png`) });
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await stage.focus();
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
  await capture('rotated');
  await page.keyboard.press('+');
  await capture('zoomed');
  await page.getByTestId('legion-3d-clean').click();
  await capture('clean');
  checks.cleanHidesHeader = !(await header.isVisible());
  await stage.press('Escape');
  await capture('restored');
  await page.getByTestId('legion-3d-filter-working').click();
  checks.statusFilterPreserved = await page.getByTestId('legion-3d-filter-working').getAttribute('aria-pressed') === 'true';
  await capture('filtered');
  await stage.press('Escape');
  // Resize within one session: the header reservation must follow layout changes.
  await page.setViewportSize({ width: width >= 640 ? 390 : 1440, height: 900 });
  await capture('resized');
  checks.noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole('link', { name: '平台视角', exact: true }).click();
  await page.waitForURL('**/legion/plaza');
  checks.plazaRoutePreserved = await page.getByRole('heading', { name: /军团/ }).isVisible();
  await page.goto(`${base}/legion`, { waitUntil: 'networkidle' });
  checks.twoDRoutePreserved = await page.getByRole('heading', { name: 'Legion', exact: true }).isVisible();
  checks.noPageErrors = errors.length === 0;
  const result = { theme, width, dense, clustered, checks, errors, frames };
  await writeFile(path.join(output, `${prefix}-checks.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ theme, width, dense, clustered, checks, errors }, null, 2));
  if (!process.argv.includes('--observe')) for (const [name, pass] of Object.entries(checks)) assert(pass, name);
} finally {
  await browser.close();
}
