// Synthetic delayed task reads. Never sends tasks or contacts a real Hub.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL;
const output = process.env.OUTPUT_DIR;
assert(base && output, 'BASE_URL and OUTPUT_DIR required');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(!['3001', '3101', '3102'].includes(new URL(base).port));
const source = await readFile(new URL(import.meta.url));
const result = { build: await fetch(`${base}/api/health`).then(r => r.json()),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim(),
  probeSha256: createHash('sha256').update(source).digest('hex'), checks: {}, errors: [], contexts: [] };
assert.equal(result.sourceDirty, false, 'Clean tracked source required');
assert.equal(result.sourceCommit, result.build.commit, 'Build/source mismatch');
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'probe-used.mjs'), source);
const browser = await chromium.launch({ headless: true });
const check = (name, value) => { result.checks[name] = !!value; };
const frames = page => page.evaluate(() => new Promise(resolve => {
  let n = 0; const next = () => ++n === 10 ? resolve() : requestAnimationFrame(next); requestAnimationFrame(next);
}));
const networks = [{ network_id: 'A', network_name: 'Scope A' }, { network_id: 'B', network_name: 'Scope B' }];

try {
  for (const scenario of ['late-success', 'late-401', 'late-error', 'late-rejection', 'late-json', 'pending-B', 'clear-filter']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(8000);
    try {
      await context.addCookies([{ name: 'anet_dashboard_session', url: base,
        value: createHash('sha256').update(`anet-dashboard:${process.env.FIXTURE_PASSWORD || 'disc-fixture-only'}`).digest('hex') }]);
      await context.addInitScript(({ scenario, networks }) => {
        sessionStorage.setItem('anet_network_id', 'A');
        localStorage.setItem('anet-sidebar-mode', 'expanded');
        sessionStorage.setItem('anet_v3_auth', JSON.stringify({ user: { username: 'fixture', role: 'owner' }, token: 'fixture-token', networks, currentNetwork: 'A' }));
        const original = window.fetch;
        const task = (scope, label) => ({ task_id: label, network_id: scope, from_name: 'fixture', to_name: 'reader', status: 'replied', content: label, created_at: '2026-01-01T00:00:00Z' });
        const payload = (scope, label) => ({ ok: true, tasks: [task(scope, label)], count: 1 });
        window.__reads = [];
        window.__delayed = new Promise(resolve => { window.__release = resolve; });
        window.__pendingB = new Promise(resolve => { window.__releaseB = resolve; });
        window.fetch = async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url, location.href);
          if (url.pathname !== '/api/hub/tasks' || url.searchParams.get('limit') !== '100') return original(input, init);
          window.__reads.push(url.pathname + url.search);
          const scope = url.searchParams.get('network_id');
          const delay = scope === 'A' && (scenario !== 'clear-filter' || url.searchParams.get('from_name') === 'old');
          if (scope === 'B' && scenario === 'pending-B') await window.__pendingB;
          if (delay && scenario !== 'late-json') await window.__delayed;
          if (delay && scenario === 'late-rejection') throw new TypeError('stale-network-failure');
          if (delay && scenario === 'late-401') return Response.json({ error: 'stale-login' }, { status: 401 });
          if (delay && scenario === 'late-error') return Response.json({ error: 'stale-forbidden' }, { status: 403 });
          const data = payload(scope, delay ? 'OBSOLETE-A' : 'CURRENT-TASK');
          const response = Response.json(data);
          if (delay && scenario === 'late-json') {
            response.json = async () => { window.__jsonStarted = true; await window.__delayed; return data; };
          }
          return response;
        };
      }, { scenario, networks });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        let json = { ok: true, nodes: [], sessions: [], tasks: [], stats: {}, messages: [] };
        if (url.pathname === '/api/hub/networks') json = { ok: true, networks };
        if (url.pathname === '/api/hub/people') json = { ok: true, people: [], total: 0 };
        if (url.pathname === '/api/hub/departments') json = { ok: true, departments: [], members: [] };
        return route.fulfill({ json });
      });
      const page = await context.newPage();
      page.on('pageerror', error => result.errors.push(`${scenario}: ${error.message}`));
      await page.goto(`${base}/tasks${scenario === 'clear-filter' ? '?from_name=old&status=replied&to_name=reader&department=__unassigned__&keep=1' : ''}`);
      await page.waitForFunction(() => window.__reads.length > 0);
      if (scenario === 'late-json') await page.waitForFunction(() => window.__jsonStarted);
      if (scenario === 'clear-filter') {
        // Populate the filtered view, then hold its next poll while the actual
        // Clear button requests the unfiltered list.
        await page.evaluate(() => window.__release());
        await page.getByText('OBSOLETE-A', { exact: true }).waitFor();
        await page.evaluate(() => {
          window.__delayed = new Promise(resolve => { window.__release = resolve; });
          window.__reads.length = 0;
        });
        // Trigger the normal 5s poll without an arbitrary timer wait.
        await page.waitForFunction(() => window.__reads.some(url => new URL(url, location.href).searchParams.get('from_name') === 'old'));
        await page.getByRole('button', { name: 'Clear', exact: true }).click();
        await page.getByText('CURRENT-TASK', { exact: true }).waitFor();
        check(`${scenario}:fourURLParamsCleared`, await page.evaluate(() => {
          const params = new URL(location.href).searchParams;
          return ['status', 'from_name', 'to_name', 'department'].every(key => !params.has(key)) && params.get('keep') === '1';
        }));
      } else {
        await page.getByTestId('network-switcher').click();
        await page.getByTestId('network-option').filter({ hasText: 'Scope B' }).click();
        await page.waitForFunction(() => window.__reads.some(url => new URL(url, location.href).searchParams.get('network_id') === 'B'));
        if (scenario !== 'pending-B') await page.getByText('CURRENT-TASK', { exact: true }).waitFor();
      }
      await page.evaluate(() => window.__release());
      try { await frames(page); } catch (error) {
        // The negative baseline redirects on a stale 401. Still record the
        // named redirect assertion instead of losing the rest of this context.
        if (!String(error).includes('Execution context was destroyed')) throw error;
        await page.waitForURL('**/login');
      }
      check(`${scenario}:noOldRows`, await page.getByText('OBSOLETE-A', { exact: true }).count() === 0);
      check(`${scenario}:noOldError`, !/stale-forbidden|stale-network-failure/.test(await page.locator('body').innerText()));
      check(`${scenario}:noOldRedirect`, new URL(page.url()).pathname === '/tasks');
      if (scenario === 'pending-B') {
        check(`${scenario}:stillLoading`, await page.locator('[data-testid="task-list-column"] .animate-pulse').isVisible());
        await page.evaluate(() => window.__releaseB());
        await page.getByText('CURRENT-TASK', { exact: true }).waitFor();
      }
      check(`${scenario}:currentRowsPreserved`, await page.getByText('CURRENT-TASK', { exact: true }).isVisible());
      check(`${scenario}:allReadsScoped`, await page.evaluate(() => window.__reads.every(url => new URL(url, location.href).searchParams.getAll('network_id').length === 1)));
      await page.screenshot({ path: path.join(output, `${scenario}.png`) });
      result.contexts.push(scenario);
    } catch (error) { result.errors.push(`${scenario}: ${error.stack}`); }
    finally { await context.close(); }
  }
} finally {
  await browser.close();
  check('allContextsCompleted', result.contexts.length === 7);
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`${Object.values(result.checks).filter(Boolean).length}/${Object.keys(result.checks).length} checks; ${result.errors.length} errors`);
  if (result.errors.length || Object.values(result.checks).some(value => !value)) process.exitCode = 1;
}
