// Isolated browser fixture. All /api reads are intercepted; no real Hub writes.
// node tests/plaza-perspective-browser.mjs http://127.0.0.1:3166 /absolute/evidence/path
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:3166';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Fixture requires a loopback server');
const output = resolve(process.argv[3] || '/tmp/opencode/plaza-perspective');
await mkdir(output, { recursive: true });
const names = ['ANet 通信研发', '产品与设计', '模型研究', '客户端工程', '深层协作组', '空部门'];
const departments = names.map((name, i) => ({ id: `d${i}`, name, parent_id: i === 3 ? 'd0' : i === 4 ? 'd3' : null, sort: i }));
const aliases = ['通信Dash欧', '通信客户端欧', '通信牛', '通信欧', '神明', 'OpenCode共享节点', '长别名用于验证完整悬浮提示的协作节点', '自动化验证'];
const agents = departments.flatMap((department, i) => Array.from({ length: i === 5 ? 0 : i === 0 ? 8 : 4 }, (_, n) => ({
  node_id: `node-${i}-${n}`, alias: i === 0 ? aliases[n] : `${department.name.slice(0, 2)}-${aliases[n]}`,
  department_id: department.id, updated_at: '2026-10-28T09:00:00Z',
})));
const ownerless = { node_id: 'ownerless-node', alias: '独立编制无负责人', department_id: 'd4' };
const nodes = [...agents, ownerless].map(a => ({ ...a, network_id: 'fixture-A', model: 'deepseek/deepseek-flash', runtime: 'opencode-sdk', lifecycle_state: 'active' }));
const sessions = nodes.map((n, i) => ({ ...n, status: ['working', 'idle', 'blocked', 'error', 'offline'][i % 5], agent: n.runtime,
  session_id: `session-${i}`, task: '', progress: 0, server: 'fixture', updated_at: '2026-10-28T09:00:00Z' }));
// Another network must never override this canonical node's current session.
sessions.push({ ...sessions[0], network_id: 'fixture-B', status: 'wrong-network' });
const people = [{ user_id: 'u1', username: 'fixture-owner', display_name: '平台验收', role: 'owner', department: { id: 'd1', name: names[1] }, agents }];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let scenario = 'normal';
const calls = [];
await context.addCookies([{ name: 'anet_dashboard_session', value: 'plaza-fixture-only', url: base }]);
await context.addInitScript(() => {
  sessionStorage.setItem('anet_network_id', 'fixture-A');
  sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-only', networks: [{ network_id: 'fixture-A', network_name: 'Fixture' }], currentNetwork: 'fixture-A' }));
  localStorage.setItem('anet-theme', 'cyber');
});
await context.route('**/api/**', async route => {
  const request = route.request(), url = new URL(request.url());
  assert.ok(['GET', 'HEAD'].includes(request.method()), `Unexpected API write: ${request.method()} ${url.pathname}`);
  calls.push(url.pathname + url.search);
  const send = (json, status = 200) => route.fulfill({ json, status });
  if (url.pathname === '/api/hub/events') return send({ ok: false }, 404);
  if (url.pathname === '/api/hub/people') {
    if (scenario === 'denied') return send({ ok: false, error: 'fixture forbidden' }, 403);
    if (scenario === 'unauthorized') return send({ ok: false }, 401);
    if (scenario === 'loading') await new Promise(resolve => setTimeout(resolve, 1300));
    return send({ ok: true, agent_department_supported: true, total: scenario === 'empty' ? 0 : 1,
      people: scenario === 'empty' ? [] : people, agents_without_owner: scenario === 'empty' ? [] : [ownerless], has_more: false });
  }
  if (url.pathname === '/api/hub/departments') return send({ ok: true, departments: scenario === 'empty' ? [] : departments, members: [] });
  if (url.pathname === '/api/hub/nodes') return send({ ok: true, nodes });
  if (url.pathname === '/api/hub/status') return scenario === 'status-error' ? send({ ok: false, error: 'fixture disconnected' }, 503) : send({ ok: true, sessions });
  if (url.pathname === '/api/hub/health' || url.pathname === '/api/health') return send({ ok: true, version: 'fixture', sessions: 25, sse_sessions: {}, sse_connections: 0, uptime: 42 });
  if (url.pathname === '/api/hub/networks') return send({ ok: true, networks: [{ network_id: 'fixture-A', network_name: 'Fixture' }] });
  return send({ ok: true, messages: [], nodes: [], requirements: [], avatars: {}, providers: [] });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const frames = async (count = 130) => page.evaluate(count => new Promise(resolve => {
  let n = 0; const tick = () => ++n >= count ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick);
}), count);
const geometry = () => page.locator('[data-testid="plaza-perspective-department"][data-department-id="dept:d0"]').evaluate(element => ({
  x: Number(element.dataset.screenX), y: Number(element.dataset.screenY), depth: Number(element.dataset.depth),
  path: element.querySelector('[data-testid="plaza-perspective-plate"]').getAttribute('d'),
}));
const svg = page.getByTestId('plaza-perspective-svg');
const verifyLabels = async () => {
  const layout = await svg.evaluate(svg => {
    const bounds = svg.getBoundingClientRect();
    const cards = [...svg.querySelectorAll('[data-testid="plaza-perspective-select"]')].map(button => button.getBoundingClientRect().toJSON());
    const mark = [...svg.querySelectorAll('[data-testid="plaza-perspective-core"] image')].find(image => getComputedStyle(image).display !== 'none').getBoundingClientRect().toJSON();
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return { contained: cards.every(c => c.left >= bounds.left && c.right <= bounds.right && c.top >= bounds.top && c.bottom <= bounds.bottom),
      overlap: cards.some((a, i) => cards.some((b, j) => i !== j && overlap(a, b))), markHidden: cards.some(c => overlap(c, mark)) };
  });
  assert.deepEqual(layout, { contained: true, overlap: false, markHidden: false }, 'default labels must fit and preserve the ANet mark');
};
try {
  await page.goto(`${base}/legion/plaza`);
  await svg.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-node-id="node-0-0"][data-session-status="working"]'));
  await frames(5);
  assert.equal(await page.getByTestId('plaza-mode-3d').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId('plaza-perspective-department').count(), 6);
  assert.equal(await page.getByTestId('plaza-perspective-namecard').filter({ hasText: '通信Dash欧' }).count() > 0, true);
  await page.screenshot({ path: `${output}/implementation-1440-dark.png`, fullPage: true });
  await verifyLabels();
  const initial = await geometry();
  const bounds = await svg.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 130, bounds.y + bounds.height - 105, { steps: 12 });
  await page.mouse.up();
  const rotated = await geometry();
  assert.ok(Math.hypot(rotated.x - initial.x, rotated.y - initial.y) > 20, 'non-origin platform must actually move');
  assert.notEqual(rotated.path, initial.path, 'plate world projection must change');
  await frames(130);
  assert.deepEqual(await geometry(), rotated, '130 RAF cannot overwrite the manual camera');
  await page.screenshot({ path: `${output}/implementation-orbit.png`, fullPage: true });
  await page.getByTestId('plaza-perspective-reset').click();
  assert.deepEqual(await geometry(), initial, 'reset button restores actual geometry');
  await svg.focus(); await page.keyboard.press('ArrowRight');
  assert.notDeepEqual(await geometry(), initial);
  await page.keyboard.press('r');
  assert.deepEqual(await geometry(), initial, 'R restores actual geometry');
  await page.getByRole('button', { name: '放大平台', exact: true }).click();
  assert.ok(Number(await svg.getAttribute('data-zoom')) > 1);
  await page.getByTestId('plaza-perspective-reset').click();

  // Pointer regressions: plates are real selection targets, and a release
  // outside the stage before capture must not turn later hover into a drag.
  const pointerChecks = {};
  for (const id of ['d2', 'd3', 'd5']) {
    const target = page.locator(`[data-testid="plaza-perspective-department"][data-department-id="dept:${id}"]`);
    const point = await target.evaluate(element => ({ x: Number(element.dataset.screenX), y: Number(element.dataset.screenY) }));
    const stage = await svg.boundingBox();
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="plaza-perspective-department"]')?.getAttribute('data-department-id'), { x: stage.x + point.x, y: stage.y + point.y });
    assert.equal(hit, `dept:${id}`, 'test must hit the visible plate');
    await page.mouse.click(stage.x + point.x, stage.y + point.y);
    pointerChecks[`plate-${id}`] = await page.getByTestId('plaza-department-select').inputValue() === `dept:${id}`;
  }
  const namecard = page.locator('[data-department-id="dept:d0"]').getByTestId('plaza-perspective-select');
  await namecard.focus(); await page.keyboard.press('Enter');
  pointerChecks.keyboardNamecard = await page.getByTestId('plaza-department-select').inputValue() === 'dept:d0';
  await page.evaluate(() => scrollTo(0, 0));
  const edge = await svg.boundingBox(), beforeEdge = await geometry();
  await page.mouse.move(edge.x + 2, edge.y + 300);
  await page.mouse.down();
  await page.mouse.move(edge.x - 20, edge.y + 280);
  await page.mouse.up();
  await page.mouse.move(edge.x + 100, edge.y + 220);
  await page.mouse.move(edge.x + 150, edge.y + 180);
  await frames(5);
  pointerChecks.releasedHoverStable = JSON.stringify(await geometry()) === JSON.stringify(beforeEdge);
  await writeFile(`${output}/pointer-regressions.json`, JSON.stringify(pointerChecks, null, 2));
  assert.ok(Object.values(pointerChecks).every(Boolean), `pointer regressions: ${JSON.stringify(pointerChecks)}`);
  await page.getByTestId('plaza-perspective-reset').click();

  const streak = page.getByTestId('plaza-perspective-streak').first();
  const phaseBefore = await streak.getAttribute('data-flow-phase');
  await frames(10);
  assert.notEqual(await streak.getAttribute('data-flow-phase'), phaseBefore, 'flow advances while enabled');
  await page.getByTestId('plaza-perspective-flow').click();
  const paused = await streak.getAttribute('data-flow-phase');
  await svg.focus(); await page.keyboard.press('ArrowRight');
  await frames(30);
  assert.equal(await streak.getAttribute('data-flow-phase'), paused, 'orbit cannot alter paused world phase');
  await page.getByTestId('plaza-perspective-flow').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('[data-testid="plaza-perspective-svg"]').dataset.flowRunning === 'false');
  const reduced = await streak.getAttribute('data-flow-phase');
  await frames(20);
  assert.equal(await streak.getAttribute('data-flow-phase'), reduced, 'live reduced-motion freezes flow');
  assert.equal(await page.getByTestId('plaza-perspective-flow').isDisabled(), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('[data-testid="plaza-perspective-svg"]').dataset.flowRunning === 'true');
  await page.getByTestId('plaza-perspective-reset').click();

  await page.getByTestId('plaza-department-select').selectOption('dept:d4');
  assert.ok((await page.getByTestId('plaza-roster').textContent()).includes('独立编制无负责人'));
  await page.getByTestId('plaza-agent').filter({ hasText: '独立编制无负责人' }).click();
  assert.ok((await page.getByTestId('plaza-node-attributes').textContent()).includes('无负责人'));
  await page.getByTestId('plaza-chat').click();
  await page.getByRole('dialog', { name: '与 独立编制无负责人 对话' }).waitFor();
  assert.equal(await page.getByTestId('legion-chat').getAttribute('data-network-id'), 'fixture-A');
  await page.getByTestId('legion-chat-close').click();
  assert.equal(await page.getByTestId('legion-chat').count(), 0);
  await page.getByTestId('plaza-department-select').selectOption('dept:d0');
  assert.equal(await page.getByTestId('plaza-perspective-namecard').filter({ hasText: 'OpenCode共享节点' }).count(), 1, 'selected platform exposes up to six aliases');
  await page.getByTestId('plaza-mode-2d').click();
  await page.getByTestId('legion-plaza-svg').waitFor();
  assert.equal(await page.getByTestId('plaza-department-select').inputValue(), 'dept:d0');
  await page.getByTestId('plaza-mode-3d').click(); await svg.waitFor();
  await page.setViewportSize({ width: 1920, height: 1080 }); await frames(5);
  await verifyLabels();
  await page.screenshot({ path: `${output}/implementation-1920-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.screenshot({ path: `${output}/implementation-1920-light.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 }); await frames(5);
  await page.screenshot({ path: `${output}/implementation-1440-light.png`, fullPage: true });
  const layout = await page.getByTestId('plaza-perspective-select').evaluateAll(buttons => buttons.map(b => ({
    name: b.getAttribute('aria-label'), rect: b.getBoundingClientRect().toJSON(), font: getComputedStyle(b.querySelector('[class*="alias"]') || b).fontSize,
  })));
  await writeFile(`${output}/implementation-label-layout.json`, JSON.stringify(layout, null, 2));
  await page.getByTestId('plaza-fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.getByTestId('plaza-fullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({ width: 390, height: 844 }); await frames(5);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByTestId('plaza-department-select').selectOption('dept:d5');
  assert.ok((await page.locator('[aria-label="部门节点与属性"]').textContent()).includes('该部门暂无 Agent'));
  await page.screenshot({ path: `${output}/implementation-390.png`, fullPage: true });

  for (const [mode, message] of [['empty', '当前网络暂无部门、成员或 Agent'], ['denied', '读取军团编制失败'], ['unauthorized', '会话已过期'], ['status-error', '节点状态与属性读取失败']]) {
    scenario = mode; await page.reload();
    await page.getByText(message, { exact: false }).first().waitFor();
    if (mode === 'status-error') await svg.waitFor();
  }
  scenario = 'loading'; await page.reload();
  await page.getByRole('status').filter({ hasText: '正在读取完整编制' }).waitFor();
  await svg.waitFor();
  assert.deepEqual(errors, []);
  assert.ok(calls.filter(u => /^\/api\/hub\/(people|departments|nodes)(\?|$)/.test(u)).every(u => u.includes('network_id=fixture-A')));
  // The existing global Sidebar separately reads unscoped /status for its network inventory.
  assert.ok(calls.includes('/api/hub/status?network_id=fixture-A'));
  await writeFile(`${output}/implementation-browser.json`, JSON.stringify({ passed: true, initial, rotated, stableFrames: 130, pointerChecks, pausedPhase: paused, calls, errors }, null, 2));
  console.log('PASS: projected geometry, 130 RAF stability, reset/R, zoom, flow/pause/live reduced-motion, names/status, ownerless/deep/empty, scoped chat open/close, 2D toggle, fullscreen, dark/light desktop, narrow layout, load/403/401/disconnect, network scope');
} finally { await browser.close(); }
