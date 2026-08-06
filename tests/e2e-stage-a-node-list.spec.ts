import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// Stage A — persistent node list rail on /nodes. Two guarantees:
//   1. Rail entries mirror the existing table (same filtered set),
//      just in a WeChat-style narrow row form.
//   2. Toggle button hides/shows the rail; state persists.
//
// Explicitly NOT tested here (covered by e2e-9-nodes-team-tag-filter):
//   - filter behavior (team, tags, search) — rail feeds off same
//     `filtered` array as the table, so filter tests transitively
//     cover rail contents too. See the "count matches table" test
//     below for the transitivity assertion.

const HUB_STATUS = {
  sessions: [
    { alias: 'stage-a-1', status: 'idle',    network_id: 'net_x' },
    { alias: 'stage-a-2', status: 'working', network_id: 'net_x' },
    { alias: 'stage-a-3', status: 'idle',    network_id: 'net_x' },
  ],
};

const HUB_NODES = {
  nodes: [
    { alias: 'stage-a-1', team: null, tags: [] },
    { alias: 'stage-a-2', team: null, tags: [] },
    { alias: 'stage-a-3', team: null, tags: [] },
  ],
};

const HUB_HEALTH = {
  ok: true,
  version: '0.9.0-test',
  sse_connections: 3,
  sse_sessions: {
    'net_x:stage-a-1': 1,
    'net_x:stage-a-2': 1,
    'net_x:stage-a-3': 1,
  },
};

// Login rate limit is 10/15min/IP (app/lib/rate-limit.ts): with 4 spec
// files in one combined run, per-test logins blow the budget and late
// tests land on the sign-in page (false red). Login once per worker.
let cachedSessionCookie: string | null = null;
async function login(context: Page['context'] extends () => infer C ? C : never) {
  if (!cachedSessionCookie) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
    });
    const setCookie = res.headers()['set-cookie'] || '';
    const m = setCookie.match(/anet_dashboard_session=([^;]+)/);
    if (m) cachedSessionCookie = decodeURIComponent(m[1]);
  }
  if (cachedSessionCookie) {
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: cachedSessionCookie,
      domain: new URL(BASE).hostname,
      path: '/',
    }]);
  }
}

async function mockCommon(page: Page) {
  // TEST_THEME=light|slack runs the whole suite under that theme — behavior
  // must hold in every theme, not just the default cyber (三主题各跑全量).
  if (process.env.TEST_THEME) {
    await page.addInitScript(t => window.localStorage.setItem('anet-theme', t as string), process.env.TEST_THEME);
  }
  // #Vincent auto-select (07-31): these suites exercise the table/filter
  // (manage) view — opt into it explicitly now that /nodes defaults to
  // conversation-first with auto-select.
  await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '1'));
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_STATUS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_NODES) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_HEALTH) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
}

test.describe('Stage A — persistent NodeList rail', () => {
  test('rail is visible by default AND contains the SAME nodes as the table', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    // Clear the localStorage anet-nodes-rail toggle first so we test the default.
    await page.addInitScript(() => window.localStorage.removeItem('anet-nodes-rail'));
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="node-list-rail"]').first()).toBeVisible({ timeout: 15000 });

    // Rail entries and table cards must have IDENTICAL alias sets —
    // this is the transitivity guarantee that lets filter tests
    // (which only assert on the table) cover the rail too.
    const railAliases = await page.locator('[data-node-list-item][data-node-list-alias]').evaluateAll(els => els.map(e => e.getAttribute('data-node-list-alias')).sort());
    const tableAliases = await page.locator('[data-node-card][data-node-alias]').evaluateAll(els => els.map(e => e.getAttribute('data-node-alias')).sort());
    expect(railAliases).toEqual(tableAliases);
    expect(railAliases).toEqual(['stage-a-1', 'stage-a-2', 'stage-a-3']);
  });

  test('toggle button hides the rail and restores it; state written to localStorage', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.addInitScript(() => window.localStorage.removeItem('anet-nodes-rail'));
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="node-list-rail"]').first()).toBeVisible({ timeout: 15000 });

    // Hide
    await page.locator('[data-testid="toggle-rail"]').click();
    await expect(page.locator('[data-testid="node-list-rail"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nodes-layout"]')).toHaveAttribute('data-rail-visible', 'false');
    // Persistence — localStorage got the '0'. Assert directly rather
    // than via reload, because Playwright's addInitScript re-runs on
    // reload and re-clears storage, which would spuriously overturn
    // the persistence signal (test-harness artifact, not product bug).
    expect(await page.evaluate(() => window.localStorage.getItem('anet-nodes-rail'))).toBe('0');

    // Show again — click restores + storage flips to '1'
    await page.locator('[data-testid="toggle-rail"]').click();
    await expect(page.locator('[data-testid="node-list-rail"]').first()).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('anet-nodes-rail'))).toBe('1');
  });

  test('rail entry click selects the alias (data-selected="true"); another click swaps selection', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.addInitScript(() => window.localStorage.removeItem('anet-nodes-rail'));
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="node-list-rail"]').first()).toBeVisible({ timeout: 15000 });

    // Initially none selected
    const initiallySelected = await page.locator('[data-node-list-item][data-selected="true"]').count();
    expect(initiallySelected).toBe(0);

    // Click stage-a-2 → chatAlias set → data-selected switches
    await page.locator('[data-node-list-alias="stage-a-2"]').click();
    await expect(page.locator('[data-node-list-alias="stage-a-2"]')).toHaveAttribute('data-selected', 'true');
    // Only one selected at a time
    await expect(page.locator('[data-node-list-item][data-selected="true"]')).toHaveCount(1);

    // Click stage-a-1 → selection swaps
    await page.locator('[data-node-list-alias="stage-a-1"]').click();
    await expect(page.locator('[data-node-list-alias="stage-a-1"]')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('[data-node-list-alias="stage-a-2"]')).toHaveAttribute('data-selected', 'false');
    await expect(page.locator('[data-node-list-item][data-selected="true"]')).toHaveCount(1);
  });
});
