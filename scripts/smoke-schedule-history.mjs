// Synthetic, loopback-only request-order acceptance. No real schedules execute.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL, output = process.env.OUTPUT_DIR;
assert(output);
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['3101', '3102', '3001'].includes(new URL(base).port));
const source = await readFile(new URL(import.meta.url));
const metadata = {
  base, fixture: true, mutation: process.env.MUTATE_HISTORY_TARGET === '1' ? 'schedule-B-to-A' : null,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  probeSha256: createHash('sha256').update(source).digest('hex'),
  build: await fetch(`${base}/api/health`).then(r => r.json()),
};
assert(!metadata.sourceDirty, 'Clean tracked source required');
assert.equal(metadata.sourceCommit, metadata.build.commit);
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'probe-used.mjs'), source);
const checks = {}, errors = [], contexts = [], observations = [], apiRequests = [];
const check = (name, value) => { checks[name] = !!value; };
const frames = (page, n = 10) => page.evaluate(n => new Promise(resolve => {
  const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), n);
const networks = [{ network_id: 'fixture', network_name: '模拟网络A' }, { network_id: 'fixture-B', network_name: '模拟网络B' }];
const run = label => ({ run_id: label, scheduled_for: '2026-10-28T01:00:00Z', created_at: '2026-10-28T01:00:00Z', status: label, task_id: `task-${label}` });
const browser = await chromium.launch({ headless: true });

async function create(theme, width, tag, noNetwork = false) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 568 : width === 390 ? 844 : 900 }, hasTouch: width < 640, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10000);
  await context.addCookies([{ name: 'anet_dashboard_session', url: base, httpOnly: true, sameSite: 'Lax',
    value: createHash('sha256').update(`anet-dashboard:${process.env.FIXTURE_PASSWORD || 'disc-fixture-only'}`).digest('hex') }]);
  await context.addInitScript(({ theme, networks, noNetwork, mutation }) => {
    localStorage.setItem('anet-theme', theme); localStorage.setItem('anet-sidebar-mode', 'expanded');
    if (!noNetwork) sessionStorage.setItem('anet_network_id', 'fixture');
    sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-token', networks, currentNetwork: noNetwork ? '' : 'fixture' }));
    // Normal acceptance only observes completion. The explicit negative control
    // sends B's reads to A to prove exact-target assertions reject a false green.
    const original = window.fetch.bind(window);
    window.__historySettled = []; let seq = 0;
    window.fetch = (...args) => {
      if (mutation === 'schedule-B-to-A' && typeof args[0] === 'string') {
        args[0] = args[0].replace('/scheduled-tasks/schedule-B/runs?', '/scheduled-tasks/schedule-A/runs?');
      }
      const promise = original(...args);
      if (String(args[0]).includes('/runs?')) {
        const id = ++seq;
        promise.then(res => res.clone().text().then(() => window.__historySettled.push(id), () => window.__historySettled.push(id)),
          () => window.__historySettled.push(id));
      }
      return promise;
    };
  }, { theme, networks: noNetwork ? [] : networks, noNetwork, mutation: metadata.mutation });
  const receivers = [], pending = [];
  let page, seq = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    apiRequests.push({ tag, method: request.method(), url: url.pathname + url.search });
    if (/\/scheduled-tasks\/[^/]+\/runs$/.test(url.pathname)) {
      const id = ++seq;
      const held = { url, id, released: false, async release(options = { json: { runs: [] } }) {
        held.released = true;
        if (options.abort) await route.abort('failed'); else await route.fulfill(options);
        await page.waitForFunction(id => window.__historySettled.includes(id), id);
        await frames(page);
      } };
      pending.push(held);
      assert(receivers.length, `${tag}: unexpected history request`);
      receivers.shift()(held);
      return;
    }
    const net = url.searchParams.get('network_id') || 'fixture';
    let json = { ok: true, nodes: [], tasks: [], messages: [], sessions: [], stats: {} };
    if (url.pathname === '/api/hub/networks') json = { ok: true, networks: noNetwork ? [] : networks };
    if (url.pathname === '/api/hub/scheduled-tasks') json = { ok: true, schedules: ['A', 'B'].map(id => ({
      schedule_id: `schedule-${id}`, name: `计划${id}-${net}`, target_node_id: 'fixture-node', target_alias: '模拟节点',
      task_content: '只读合成验收', priority: 'normal', schedule: { type: 'interval', every_seconds: 3600 },
      timezone: 'UTC', status: 'active', revision: 1,
    })) };
    return route.fulfill({ json });
  });
  page = await context.newPage();
  page.on('pageerror', e => errors.push({ tag, error: e.stack || String(e) }));
  await page.goto(`${base}/scheduled-tasks`, { waitUntil: 'domcontentloaded' });
  if (noNetwork) await page.getByText('请先在左侧选择一个网络', { exact: true }).waitFor();
  else await page.getByRole('heading', { name: '计划A-fixture', exact: true }).waitFor();
  const card = (id, net = 'fixture') => page.locator('main section').filter({ has: page.getByRole('heading', { name: `计划${id}-${net}`, exact: true }) });
  const button = (id, net) => card(id, net).getByRole('button', { name: '记录', exact: true });
  async function request(expected, action) {
    assert(expected.scheduleId && expected.networkId, 'Each read must declare its expected target');
    let timer;
    const received = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${tag}: history request not observed`)), 10000);
      receivers.push(resolve);
    });
    try {
      await action();
      const held = await received, query = held.url.searchParams;
      const target = {
        exactSchedule: held.url.pathname === `/api/hub/scheduled-tasks/${encodeURIComponent(expected.scheduleId)}/runs`,
        exactNetwork: query.getAll('network_id').length === 1 && query.get('network_id') === expected.networkId,
        exactLimit: query.getAll('limit').length === 1 && query.get('limit') === '50',
      };
      for (const [name, passed] of Object.entries(target)) check(`${tag}:read${held.id}:${name}`, passed);
      assert(Object.values(target).every(Boolean), `${tag}: read${held.id} target mismatch: ${held.url.pathname}${held.url.search}`);
      return held;
    } finally { clearTimeout(timer); }
  }
  async function shot(suffix) {
    observations.push({ tag: `${tag}-${suffix}`, text: await page.locator('main').last().innerText() });
    await page.screenshot({ path: path.join(output, `${tag}-${suffix}.png`), fullPage: true });
  }
  async function close() {
    for (const p of pending) if (!p.released) await p.release({ abort: true });
    await context.close();
  }
  return { page, card, button, request, shot, close };
}

try {
  for (const theme of ['cyber', 'light']) for (const width of [1440, 390, 320]) {
    for (const scenario of ['switch-success', 'switch-error', 'reopen', 'network', 'states']) {
      const tag = `${theme}-${width}-${scenario}`;
      const f = await create(theme, width, tag);
      const { page, card, button, request } = f;
      try {
        const a = await request({ scheduleId: 'schedule-A', networkId: 'fixture' }, () => button('A').click());
        check(`${tag}:requestScoped`, a.url.searchParams.get('network_id') === 'fixture' && a.url.searchParams.get('limit') === '50');
        check(`${tag}:loadingNotEmpty`, (await card('A').innerText()).includes('正在读取执行记录') && !(await card('A').innerText()).includes('暂无执行记录'));
        if (scenario.startsWith('switch')) {
          const b = await request({ scheduleId: 'schedule-B', networkId: 'fixture' }, () => button('B').click());
          await b.release({ json: { runs: [run('NEW-B')] } });
          check(`${tag}:currentResponseShown`, (await card('B').innerText()).includes('NEW-B'));
          if (scenario === 'switch-error') await a.release({ status: 403, json: { error: 'OLD-A-DENIED' } });
          else await a.release({ json: { runs: [run('OLD-A')] } });
          check(`${tag}:lateResponseIgnored`, (await card('B').innerText()).includes('NEW-B') && !(await page.locator('main').last().innerText()).includes('OLD-A'));
          check(`${tag}:previousHistoryClosed`, await card('A').locator('table').count() === 0);
          await f.shot('late-response');
        } else if (scenario === 'reopen') {
          await button('A').click();
          check(`${tag}:closed`, await card('A').locator('table').count() === 0 && !(await card('A').innerText()).includes('正在读取执行记录'));
          const newer = await request({ scheduleId: 'schedule-A', networkId: 'fixture' }, () => button('A').click());
          await newer.release({ json: { runs: [run('NEW-A')] } });
          await a.release({ json: { runs: [run('OLD-A')] } });
          check(`${tag}:reopenGeneration`, (await card('A').innerText()).includes('NEW-A') && !(await card('A').innerText()).includes('OLD-A'));
          await f.shot('reopened');
        } else if (scenario === 'network') {
          if (width < 640) await page.getByRole('button', { name: 'Toggle menu', exact: true }).click();
          await page.getByTestId('network-switcher').click();
          await page.getByTestId('network-option').filter({ hasText: '模拟网络B' }).click();
          await page.getByRole('heading', { name: '计划A-fixture-B', exact: true }).waitFor();
          check(`${tag}:networkClosesHistory`, await card('A', 'fixture-B').locator('table').count() === 0 && !(await card('A', 'fixture-B').innerText()).includes('暂无执行记录'));
          // Old builds retain an open row with the same ID: close it so both can
          // issue the same new-network request before releasing the old response.
          if (await card('A', 'fixture-B').locator('table').count()) await button('A', 'fixture-B').click();
          const b = await request({ scheduleId: 'schedule-A', networkId: 'fixture-B' }, () => button('A', 'fixture-B').click());
          await b.release({ json: { runs: [run('NETWORK-B')] } });
          await a.release({ json: { runs: [run('NETWORK-A')] } });
          check(`${tag}:newNetworkScoped`, b.url.searchParams.get('network_id') === 'fixture-B');
          check(`${tag}:lateNetworkIgnored`, (await card('A', 'fixture-B').innerText()).includes('NETWORK-B') && !(await page.locator('main').last().innerText()).includes('NETWORK-A'));
          await f.shot('network-B');
        } else {
          await a.release();
          check(`${tag}:genuineEmpty`, (await card('A').innerText()).includes('暂无执行记录'));
          await button('A').click();
          for (const [name, response, message] of [
            ['forbidden', { status: 403, json: { error: 'fixture_denied', message: '没有查看执行记录的权限' } }, /权限|403|fixture_denied/],
            ['unauthorized', { status: 401, json: { error: 'login_required' } }, /登录|401|login_required/],
            ['html', { status: 502, contentType: 'text/html', body: '<html>fixture proxy failure</html>' }, /502/],
            ['malformed', { status: 200, contentType: 'text/plain', body: 'not-json' }, /响应|格式/],
            ['missingRuns', { json: { ok: true } }, /响应|格式/],
            ['null', { json: null }, /响应|格式/],
            ['disconnected', { abort: true }, /fetch|连接|网络/i],
          ]) {
            const held = await request({ scheduleId: 'schedule-A', networkId: 'fixture' }, () => button('A').click());
            await held.release(response);
            const text = await card('A').innerText();
            check(`${tag}:${name}:localError`, message.test(text));
            check(`${tag}:${name}:notFakeEmpty`, !text.includes('暂无执行记录'));
            const retry = card('A').getByRole('button', { name: '重试', exact: true });
            check(`${tag}:${name}:retryAvailable`, await retry.count() === 1);
            if (name === 'forbidden' || name === 'disconnected') await f.shot(name);
            if (await retry.count()) {
              await retry.focus();
              const recover = await request({ scheduleId: 'schedule-A', networkId: 'fixture' }, () => page.keyboard.press('Enter'));
              await recover.release({ json: { runs: [run('RECOVERED')] } });
              check(`${tag}:${name}:retryRecovers`, (await card('A').innerText()).includes('RECOVERED') && await card('A').getByRole('alert').count() === 0);
              check(`${tag}:${name}:focusRetained`, await card('A').getByRole('button', { name: '刷新记录', exact: true }).evaluate(el => el === document.activeElement));
            } else {
              check(`${tag}:${name}:retryRecovers`, false); check(`${tag}:${name}:focusRetained`, false);
            }
            await button('A').click();
          }
          check(`${tag}:historyTarget44`, await button('A').evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
        }
        check(`${tag}:noPageOverflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        contexts.push(tag);
      } finally { await f.close(); }
    }
  }
  const f = await create('light', 320, 'no-network', true);
  try {
    await frames(f.page);
    check('no-network:noScheduleReads', !apiRequests.some(r => r.tag === 'no-network' && /scheduled-tasks/.test(r.url)));
    contexts.push('no-network');
  } finally { await f.close(); }
} catch (e) {
  errors.push({ error: e.stack || String(e) });
} finally {
  await browser.close();
  check('allContextsCompleted', contexts.length === 31);
  check('noRealMutations', apiRequests.every(r => r.method === 'GET'));
  check('noUnscopedScheduleReads', apiRequests.filter(r => /scheduled-tasks/.test(r.url)).every(r => new URL(r.url, base).searchParams.get('network_id')));
  const result = { ...metadata, passed: Object.values(checks).filter(Boolean).length, failed: Object.keys(checks).filter(k => !checks[k]), contexts, errors, checks, observations, apiRequests };
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...metadata, passed: result.passed, failed: result.failed, contexts, errors }, null, 2));
  assert(result.failed.length === 0 && errors.length === 0, 'Schedule history acceptance failed');
}
