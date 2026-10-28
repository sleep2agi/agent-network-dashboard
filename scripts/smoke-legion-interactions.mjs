// Loopback-only synthetic interaction acceptance. No Hub credentials or writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL || 'http://127.0.0.1:3141';
const output = process.env.OUTPUT_DIR;
const plazaMode = process.env.PLAZA_MODE || '2d';
assert(['2d', '3d'].includes(plazaMode), 'PLAZA_MODE must be 2d or 3d');
const plazaScene = plazaMode === '3d' ? 'plaza-perspective-svg' : 'legion-plaza-svg';
assert(output, 'OUTPUT_DIR required');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['3101', '3102'].includes(new URL(base).port), 'Use an isolated fixture port');
const source = await readFile(new URL(import.meta.url));
const metadata = { base, fixture: true, plazaMode,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  probeSha256: createHash('sha256').update(source).digest('hex'),
  build: await fetch(`${base}/api/health`).then(r => r.json()),
};
assert.equal(metadata.sourceDirty, false, 'Clean tracked source required');
assert.equal(metadata.sourceCommit, metadata.build.commit, 'Build/source mismatch');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'probe-used.mjs'), source);
const checks = {}, errors = [], contexts = [];
const check = (name, result) => { checks[name] = !!result; };
const frames = (page, count = 8) => page.evaluate(count => new Promise(resolve => {
  let n = 0; const next = () => ++n >= count ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next);
}), count);
const departments = [{ id: 'root', name: '协同中心' }, { id: 'leaf', name: 'Agent独立部门', parent_id: 'root' },
  { id: 'deep', name: '三级研发与跨平台交互体验技术验证部门', parent_id: 'leaf' }, { id: 'empty', name: '空部门' }, { id: 'bulk', name: '密集部门' }];
const agent = (node_id, alias, department_id, updated_at = '2026-01-02T00:00:00Z') => ({ node_id, alias, department_id, updated_at, lifecycle_state: 'active' });
const target = agent('latest-target', '模拟对话节点', 'leaf');
const person = (id, agents) => ({ user_id: id, username: id, display_name: `模拟成员${id}`, role: 'member', department: { id: 'root', name: '协同中心' }, agents });
const people = [person('1', [agent('old-target', target.alias, 'root', '2026-01-01T00:00:00Z'), target, { node_id: 'unplaced', alias: '未归属节点' }]),
  person('2', [agent('helper', '第二页节点', 'deep')])];
const orphans = [agent('orphan', '无负责人节点', 'leaf'), ...Array.from({ length: 27 }, (_, i) => agent(`bulk-${i}`, `密集节点${String(i).padStart(2, '0')}`, 'bulk'))];
const all = [...people.flatMap(p => p.agents), ...orphans];
const networks = [{ network_id: 'fixture', network_name: '模拟网络A' }, { network_id: 'fixture-B', network_name: '模拟网络B' }];
const longModel = 'openrouter/anthropic/claude-opus-4.6:thinking';
const browser = await chromium.launch({ headless: true });

async function create(theme, width, mode = 'plaza', state = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : width === 390 ? 844 : 900 }, hasTouch: width < 640, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10000);
  await context.addCookies([{ name: 'anet_dashboard_session', url: base, httpOnly: true, sameSite: 'Lax',
    value: createHash('sha256').update(`anet-dashboard:${process.env.FIXTURE_PASSWORD || 'disc-fixture-only'}`).digest('hex') }]);
  const requests = [], sends = [];
  await context.addInitScript(({ theme, networks, noNetwork }) => {
    localStorage.setItem('anet-theme', theme); localStorage.setItem('anet-sidebar-mode', 'expanded');
    if (!noNetwork) sessionStorage.setItem('anet_network_id', 'fixture');
    sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-token', networks, currentNetwork: 'fixture' }));
    const proto = CanvasRenderingContext2D.prototype;
    const begin = proto.setTransform, ellipse = proto.ellipse;
    proto.setTransform = function (...args) { if (this.canvas.getAttribute('aria-label') === '军团三维拓扑图' && args.join(',') === '1,0,0,1,0,0') window.__departments = []; return begin.apply(this, args); };
    proto.ellipse = function (...args) { if (this.canvas.getAttribute('aria-label') === '军团三维拓扑图') (window.__departments ??= []).push(args.slice(0, 4)); return ellipse.apply(this, args); };
  }, { theme, networks, noNetwork: !!state.noNetwork });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      requests.push(url.pathname + url.search);
      const net = url.searchParams.get('network_id') || 'fixture';
      const records = mode === '3d' ? [target] : all;
      let json = { ok: true, nodes: [], tasks: [], messages: [], stats: {} }, status = 200;
      if (url.pathname === '/api/hub/networks') json = { ok: true, networks: state.noNetwork ? [] : networks };
      if (url.pathname === '/api/hub/people') {
        if (state.secondPageError && Number(url.searchParams.get('offset')) > 0) return route.fulfill({ status: 403, json: { ok: false, error: 'fixture_page2_denied' } });
        if (state.peopleError) return route.fulfill({ status: state.peopleError, json: { ok: false, error: `fixture_people_${state.peopleError}` } });
        if (state.hold) await state.hold;
        if (state.empty) json = { ok: true, people: [], agents_without_owner: [], has_more: false, total: 0, agent_department_supported: true };
        else if (mode === '3d') json = { ok: true, people: [person('1', [target])], total: 1, has_more: false, agents_without_owner: [] };
        else { const offset = Number(url.searchParams.get('offset')); json = { ok: true, people: [people[offset === 0 ? 0 : 1]], total: 2, has_more: offset === 0, next_offset: offset === 0 ? 1 : null,
          ...(state.legacy ? {} : { agent_department_supported: true }), ...(offset === 0 ? { agents_without_owner: orphans } : {}) }; }
      }
      if (url.pathname === '/api/hub/departments') {
        status = state.legacy ? 404 : 200; json = { ok: !state.legacy, departments: state.empty ? [] : departments, members: [] };
      }
      if (url.pathname === '/api/hub/nodes') {
        status = state.metadataError || 200; json = { ok: status === 200, error: status !== 200 ? 'fixture_metadata' : undefined,
          nodes: records.map(a => ({ ...a, network_id: net, model: a.node_id === 'orphan' ? longModel : a.node_id === 'old-target' ? 'old-model' : `fixture-model-${net}`, runtime: 'opencode', hostname: 'fixture-host', lifecycle_controllable: false })) };
      }
      if (url.pathname === '/api/hub/status') json = { ok: true, sessions: records.map(a => ({ ...a, network_id: net, status: 'idle', task: '等待模拟任务', runtime: 'opencode', project_dir: '/workspace/fixture', session_id: `session-${a.node_id}`, server: 'fixture-host' })) };
      if (url.pathname === '/api/hub/health') json = { ok: true, version: 'fixture', sse_sessions: { [`${net}:${target.alias}`]: 1 }, sessions: records.length };
      if (url.pathname === '/api/hub/tasks') {
        status = state.historyError || 200;
        json = { ok: status === 200, ...(status === 501 ? { error: 'hub_tasks_scope_unsupported' } : {}), tasks: status === 200 ? [{ task_id: `history-${net}`, to_name: target.alias, from_name: 'fixture', created_at: '2026-01-01T00:00:00Z', status: 'replied', content: `历史消息-${net}`, result: '模拟回复' }] : undefined };
      }
      if (url.pathname === '/api/hub/send') {
        sends.push(route.request().postDataJSON()); status = state.sendError || 200;
        json = status === 200 ? { ok: true, message_id: `fixture-send-${sends.length}`, status: 'delivered' } : { ok: false, error: 'fixture-send-denied' };
      }
      return route.fulfill({ status, json });
    }
    if (url.pathname === '/avatars/manifest.json') return route.fulfill({ json: Object.fromEntries(all.map(a => [a.alias, '/avatars/fixture.svg'])) });
    if (url.pathname === '/avatars/fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#247876"/><circle cx="20" cy="16" r="9" fill="#e8eddf"/></svg>' });
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.stack || String(e)));
  await page.goto(`${base}/legion/${mode === '3d' ? '3d' : 'plaza'}`, { waitUntil: 'domcontentloaded' });
  if (mode === 'plaza') await page.getByTestId(`plaza-mode-${plazaMode}`).click();
  return { context, page, requests, sends, state };
}

async function chatFlow(page, requests, sends, state, tag, opener) {
  const url = page.url();
  await opener.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => scrollY);
  await opener.click();
  const dialog = page.getByTestId('legion-chat');
  await dialog.waitFor();
  await dialog.getByText('历史消息-fixture', { exact: true }).first().waitFor();
  check(`${tag}:sameRoute`, page.url() === url);
  check(`${tag}:historyScoped`, requests.some(r => r.startsWith('/api/hub/tasks?') && new URL(r, base).searchParams.get('network_id') === 'fixture'));
  check(`${tag}:focusInDialog`, await dialog.evaluate(el => el.contains(document.activeElement)));
  const input = dialog.locator('textarea');
  await input.pressSequentially('r?F 模拟消息');
  await Promise.all([page.waitForResponse('**/api/hub/send'), dialog.getByRole('button', { name: 'Send message', exact: true }).click()]);
  check(`${tag}:sendExactTarget`, sends.length === 1 && sends[0].alias === target.alias && sends[0].network_id === 'fixture' && sends[0].task === 'r?F 模拟消息');
  state.sendError = 403;
  await input.fill('模拟拒绝');
  await Promise.all([page.waitForResponse('**/api/hub/send'), dialog.getByRole('button', { name: 'Send message', exact: true }).click()]);
  await dialog.getByRole('button', { name: /发送失败，点击查看原因|Send failed — tap for reason/ }).click();
  await dialog.getByText(/fixture-send-denied/).first().waitFor();
  check(`${tag}:sendFailureVisible`, true);
  await input.fill('保留草稿');
  check(`${tag}:pageScrollRetained`, Math.abs(await page.evaluate(() => scrollY) - scrollBefore) <= 1);
  check(`${tag}:closeTouchTarget`, await page.getByTestId('legion-chat-close').evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
  await page.getByTestId('legion-chat-close').focus();
  await page.keyboard.press('Shift+Tab');
  check(`${tag}:tabWrapsInside`, await dialog.evaluate(el => el.contains(document.activeElement) && document.activeElement !== el.querySelector('[data-testid="legion-chat-close"]')));
  await page.screenshot({ path: path.join(output, `${tag}-chat.png`) });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  check(`${tag}:focusRestored`, await opener.evaluate(el => el === document.activeElement));
  await opener.click();
  await input.waitFor();
  check(`${tag}:draftRestored`, await input.inputValue() === '保留草稿');
  await page.getByTestId('legion-chat-close').click();
}

try {
  for (const theme of ['cyber', 'light']) for (const width of [1440, 1024, 390, 320]) {
    const tag = `plaza-${theme}-${width}`;
    const { page, context, requests, sends, state } = await create(theme, width);
    try {
      await page.getByText('6 个展台 · 2 名成员 · 31 个 Agent', { exact: true }).waitFor();
      const fullscreenButton = page.getByTestId('plaza-fullscreen');
      const fullscreenTarget = await fullscreenButton.evaluate(button => {
        const r = button.getBoundingClientRect();
        const hits = [4, r.width / 2, r.width - 4].flatMap(dx => [4, r.height / 2, r.height - 4]
          .map(dy => button.contains(document.elementFromPoint(r.x + dx, r.y + dy))));
        return { width: r.width, height: r.height, right: r.right, bottom: r.bottom, allHit: hits.every(Boolean) };
      });
      check(`${tag}:fullscreen44pxTarget`, fullscreenTarget.width >= 44 && fullscreenTarget.height >= 44);
      check(`${tag}:fullscreenAllPointsHit`, fullscreenTarget.allHit);
      // Exercise the initial edge before scrolling; center-only clicks missed the dock overlap.
      await page.mouse.click(fullscreenTarget.right - 4, fullscreenTarget.bottom - 4);
      await frames(page, 20);
      const fullscreenEntered = await page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid') === 'legion-plaza-stage');
      check(`${tag}:fullscreenEdgeClick`, fullscreenEntered);
      check(`${tag}:fullscreenDidNotOpenServers`, await page.getByRole('button', { name: 'Collapse servers panel', exact: true }).count() === 0);
      if (fullscreenEntered) {
        await fullscreenButton.click();
        await page.waitForFunction(() => document.fullscreenElement == null);
      }
      await page.screenshot({ path: path.join(output, `${tag}-overview.png`) });
      check(`${tag}:allPagesAndDedup`, requests.some(r => r.includes('/api/hub/people?') && new URL(r, base).searchParams.get('offset') === '1'));
      // The upright namecard layer shares department IDs with world geometry.
      // Count contracts belong to the platform entity in both 2D and 3D.
      check(`${tag}:agentOnlyVisible`, await page.locator('[data-department-id="dept:leaf"][data-agent-count]').getAttribute('data-agent-count') === '2');
      check(`${tag}:modernUnassigned`, await page.locator('[data-department-id="unassigned"][data-agent-count]').getAttribute('data-agent-count') === '1');
      check(`${tag}:trueParentLink`, await page.locator('[data-from="dept:root"][data-to="dept:leaf"] path[filter]').count() === 1);
      check(`${tag}:emptyPreserved`, await page.locator('[data-department-id="dept:empty"][data-agent-count]').getAttribute('data-agent-count') === '0');
      await page.getByTestId('plaza-department-select').selectOption('dept:leaf');
      const longRow = page.locator('[data-testid="plaza-agent"][data-node-id="orphan"]');
      await longRow.getByText(`${longModel} · opencode`, { exact: true }).waitFor();
      await page.getByTestId('plaza-department-select').scrollIntoViewIfNeeded();
      const rosterBounds = await longRow.evaluate(row => {
        const r = row.getBoundingClientRect(), status = row.lastElementChild.getBoundingClientRect();
        let left = 0, right = innerWidth;
        for (let parent = row.parentElement; parent; parent = parent.parentElement) {
          if (['hidden', 'auto', 'scroll', 'clip'].includes(getComputedStyle(parent).overflowX)) {
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left); right = Math.min(right, clip.right);
          }
        }
        return { rowFits: r.left >= left && r.right <= right, statusFits: status.left >= left && status.right <= right };
      });
      check(`${tag}:longModelRosterFitsPanel`, rosterBounds.rowFits);
      check(`${tag}:longModelStatusVisible`, rosterBounds.statusFits);
      await page.screenshot({ path: path.join(output, `${tag}-roster-long-model.png`) });
      await page.locator('[data-testid="plaza-agent"][data-node-id="latest-target"]').click();
      const attrs = page.getByTestId('plaza-node-attributes');
      await attrs.getByText('fixture-model-fixture', { exact: true }).waitFor();
      check(`${tag}:attributesExactId`, !(await attrs.textContent()).includes('old-model') && (await attrs.textContent()).includes('/workspace/fixture'));
      await page.screenshot({ path: path.join(output, `${tag}-attributes.png`) });
      check(`${tag}:noOverflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await chatFlow(page, requests, sends, state, tag, page.getByTestId('plaza-chat'));
      await page.getByTestId('plaza-department-select').selectOption('dept:bulk');
      check(`${tag}:rosterPaged`, await page.getByTestId('plaza-agent').count() === 24);
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      check(`${tag}:lastRosterPage`, await page.getByTestId('plaza-agent').count() === 3);
      await page.getByTestId('plaza-fullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement?.getAttribute('data-testid') === 'legion-plaza-stage');
      check(`${tag}:fullscreenActual`, await page.getByTestId('plaza-fullscreen').getAttribute('aria-pressed') === 'true');
      await page.getByTestId('plaza-fullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement == null);
      await page.evaluate(() => { document.querySelector('[data-testid="legion-plaza-stage"]').requestFullscreen = async () => { throw new Error('fixture denied'); }; });
      await page.getByTestId('plaza-fullscreen').click();
      await page.getByText('浏览器未允许全屏，请检查权限后重试').waitFor();
      check(`${tag}:fullscreenDenied`, await page.getByTestId('plaza-fullscreen').getAttribute('aria-pressed') === 'false');
      if (width === 1440) {
        await page.getByTestId('network-switcher').click();
        await page.getByTestId('network-option').filter({ hasText: '模拟网络B' }).click();
        await page.getByTestId('plaza-department-select').selectOption('dept:leaf');
        await page.locator('[data-testid="plaza-agent"][data-node-id="latest-target"]').click();
        await attrs.getByText('fixture-model-fixture-B', { exact: true }).waitFor();
        await page.getByTestId('plaza-chat').click();
        await page.getByTestId('legion-chat').getByText('历史消息-fixture-B', { exact: true }).first().waitFor();
        check(`${tag}:networkHistoryIsolated`, await page.getByTestId('legion-chat').getByText('历史消息-fixture', { exact: true }).count() === 0 && await page.getByTestId('legion-chat').locator('textarea').inputValue() === '');
      }
      contexts.push(tag);
    } catch (e) { errors.push(`${tag}: ${e.stack || e}`); } finally { await context.close(); }
  }
  for (const theme of ['cyber', 'light']) for (const width of [1440, 390]) {
    const tag = `3d-${theme}-${width}`;
    const { page, context, requests, sends, state } = await create(theme, width, '3d');
    try {
      const stage = page.getByTestId('legion-3d-stage');
      await page.getByTestId('legion-3d-list-toggle').click();
      await page.getByRole('option', { name: `Agent ${target.alias}`, exact: true }).click();
      if (await page.getByTestId('legion-3d-list-toggle').getAttribute('aria-expanded') === 'true') await page.getByTestId('legion-3d-list-toggle').click();
      if (await page.getByTestId('legion-3d-spin').getAttribute('aria-pressed') === 'true') await page.getByTestId('legion-3d-spin').click();
      await frames(page, 130);
      const before = await page.evaluate(() => window.__departments[0]);
      const canvas = await page.getByRole('img', { name: '军团三维拓扑图' }).boundingBox();
      await page.mouse.move(canvas.x + before[0], canvas.y + before[1]);
      await page.mouse.down(); await page.mouse.move(canvas.x + before[0] + 70, canvas.y + before[1] + 35, { steps: 6 }); await page.mouse.up();
      await frames(page, 130);
      const moved = await page.evaluate(() => window.__departments[0]);
      check(`${tag}:actualNonOriginDrag`, Math.hypot(moved[0] - before[0], moved[1] - before[1]) > 1);
      await chatFlow(page, requests, sends, state, tag, page.getByTestId('legion-3d-chat'));
      await frames(page, 130);
      const after = await page.evaluate(() => window.__departments[0]);
      check(`${tag}:cameraRetained`, after.every((v, i) => Math.abs(v - moved[i]) < 0.5));
      await stage.focus(); await page.keyboard.press('Enter');
      await page.getByTestId('legion-chat').waitFor();
      check(`${tag}:enterStaysIn3d`, new URL(page.url()).pathname === '/legion/3d');
      contexts.push(tag);
    } catch (e) { errors.push(`${tag}: ${e.stack || e}`); } finally { await context.close(); }
  }
  for (const [label, state] of Object.entries({ forbidden: { peopleError: 403 }, login: { peopleError: 401 }, disconnected: { peopleError: 502 }, empty: { empty: true }, legacy: { legacy: true }, metadata: { metadataError: 403 }, noNetwork: { noNetwork: true }, page2: { secondPageError: true }, history: { historyError: 403 }, unsupported: { historyError: 501 } })) {
    const tag = `state-${label}`, { page, context } = await create('light', 390, 'plaza', state);
    try {
      const stage = page.getByTestId('legion-plaza-stage');
      if (state.noNetwork) { await stage.getByTestId('network-required').waitFor(); check(`${tag}:networkRequired`, true); }
      else if (state.secondPageError) { await stage.getByText(/fixture_page2_denied/).waitFor(); check(`${tag}:noPartialCounts`, !await page.getByTestId(plazaScene).isVisible()); }
      else if (state.historyError) {
        await page.getByTestId('plaza-department-select').selectOption('dept:leaf');
        await page.locator('[data-testid="plaza-agent"][data-node-id="latest-target"]').click();
        await page.getByTestId('plaza-chat').click();
        await page.getByText(state.historyError === 501 ? '当前 Hub 不支持按网络读取历史，请升级 Hub 后重新打开对话' : '无权读取当前网络的历史，请联系网络管理员', { exact: true }).waitFor();
        check(`${tag}:historyDeniedNotEmpty`, true);
        if (state.historyError === 501) check(`${tag}:noRetryLoop`, !await page.getByRole('button', { name: '重试加载历史', exact: true }).isVisible());
      }
      else if (state.peopleError) {
        await stage.getByRole('alert').waitFor();
        check(`${tag}:notEmpty`, !await stage.getByText('当前网络暂无部门、成员或 Agent').isVisible());
        if (label === 'disconnected') { delete state.peopleError; await stage.getByRole('button', { name: '重试', exact: true }).click(); await page.getByTestId(plazaScene).waitFor(); check(`${tag}:retryRestores`, true); }
      } else if (state.empty) { await stage.getByText('当前网络暂无部门、成员或 Agent').waitFor(); check(`${tag}:honestEmpty`, true); }
      else if (state.legacy) { await stage.getByText('当前 Hub 未提供 Agent 独立部门能力，暂按负责人部门展示。').waitFor(); check(`${tag}:legacyExplained`, true); }
      else { await stage.getByText(/节点属性读取失败/).waitFor(); check(`${tag}:metadataErrorVisible`, true); }
      await page.screenshot({ path: path.join(output, `${tag}.png`) }); contexts.push(tag);
    } catch (e) { errors.push(`${tag}: ${e.stack || e}`); } finally { await context.close(); }
  }
  {
    let release;
    const state = { hold: new Promise(resolve => { release = resolve; }) };
    const { page, context } = await create('light', 390, 'plaza', state);
    try {
      const stage = page.getByTestId('legion-plaza-stage');
      await stage.getByRole('status').waitFor();
      check('state-loading:notEmpty', !await stage.getByText('当前网络暂无部门、成员或 Agent').isVisible());
      release();
      await page.getByText('6 个展台 · 2 名成员 · 31 个 Agent', { exact: true }).waitFor();
      check('state-loading:recovers', true); contexts.push('state-loading');
    } catch (e) { errors.push(`state-loading: ${e.stack || e}`); } finally { release(); await context.close(); }
  }
} finally {
  await browser.close();
  check('allContextsCompleted', contexts.length === 23);
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ...metadata, checks, contexts, errors }, null, 2));
  console.log(JSON.stringify({ ...metadata, passed: Object.values(checks).filter(Boolean).length, failed, contexts, errors }, null, 2));
  assert(!errors.length && !failed.length, 'Interaction acceptance failed');
}
