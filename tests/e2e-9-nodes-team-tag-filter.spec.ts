import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// #492 Goal-3 step 2 — /nodes filter by team/tag. Three fixtures with
// DELIBERATELY MIXED attr values so tests can't accidentally pass on
// the "everyone has team X, so filter=X shows everyone" trap.
//
// Per PR review (通信龙):
//   - team fixture MUST contain (a) target-team nodes, (b) empty-team
//     nodes, (c) other-team nodes. Assert filter result equals the
//     EXACT alias set, not just count.
//   - tag fixture MUST contain (a) nodes with target-tag, (b) nodes
//     with a different tag, (c) nodes with empty tags[]. Assert AND
//     semantics catch nodes with ALL selected tags, not any.
//   - Empty state copy MUST echo the filter conditions under AND
//     (e.g. "no nodes with A and B") so a 0-result intersection
//     doesn't look like a data-sync bug.
//   - Cold-start (no node has any attrs) MUST render its own copy
//     ("还没有节点被打过标签"), not generic "no match".

// Fixture 1 — TEAMS: mixed values.
const HUB_STATUS_TEAMS = {
  sessions: [
    { alias: 'alpha-a', status: 'idle', network_id: 'net_x' },
    { alias: 'alpha-b', status: 'idle', network_id: 'net_x' },
    { alias: 'beta-a',  status: 'idle', network_id: 'net_x' },
    { alias: 'no-team', status: 'idle', network_id: 'net_x' },
  ],
};
const HUB_NODES_TEAMS = {
  nodes: [
    { alias: 'alpha-a', team: 'alpha', tags: [] },
    { alias: 'alpha-b', team: 'alpha', tags: [] },
    { alias: 'beta-a',  team: 'beta',  tags: [] },
    { alias: 'no-team', team: null,    tags: [] },
  ],
};

// Fixture 2 — TAGS: mixed values including empty and disjoint tag sets.
const HUB_STATUS_TAGS = {
  sessions: [
    { alias: 'both-tags',       status: 'idle', network_id: 'net_x' },  // has BOTH a,b
    { alias: 'a-only',   status: 'idle', network_id: 'net_x' },  // has just a
    { alias: 'b-only',   status: 'idle', network_id: 'net_x' },  // has just b
    { alias: 'no-tags',  status: 'idle', network_id: 'net_x' },  // has none
  ],
};
const HUB_NODES_TAGS = {
  nodes: [
    // Adding a third distinct tag 'canary' on 'b-only' so an AND like
    // {prod,canary} produces 0 results — used by the empty-state-copy test.
    { alias: 'both-tags',      team: null, tags: ['prod', 'db'] },
    { alias: 'a-only',  team: null, tags: ['prod'] },
    { alias: 'b-only',  team: null, tags: ['db', 'canary'] },
    { alias: 'no-tags', team: null, tags: [] },
  ],
};

// Fixture 3 — COLD START: no attrs at all. Filter chrome must NOT
// appear (no distinct teams/tags); if user has filterStatus/search set
// AND gets no results, the copy must say "no nodes tagged yet".
const HUB_STATUS_COLD = {
  sessions: [
    { alias: 'untagged-1', status: 'idle', network_id: 'net_x' },
    { alias: 'untagged-2', status: 'idle', network_id: 'net_x' },
  ],
};
const HUB_NODES_COLD = {
  nodes: [
    { alias: 'untagged-1', team: null, tags: [] },
    { alias: 'untagged-2', team: null, tags: [] },
  ],
};

const HUB_HEALTH_EMPTY = {
  ok: true,
  version: '0.9.0-test',
  sse_connections: 0,
  sse_sessions: {},
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

async function mockCommon(page: Page, statusBody: object, nodesBody: object) {
  // TEST_THEME=light|slack runs the whole suite under that theme — behavior
  // must hold in every theme, not just the default cyber (三主题各跑全量).
  if (process.env.TEST_THEME) {
    await page.addInitScript(t => window.localStorage.setItem('anet-theme', t as string), process.env.TEST_THEME);
  }
  // #Vincent auto-select (07-31): filter suite exercises the manage/table
  // view — opt in explicitly now that /nodes defaults to conversation-first.
  await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '1'));
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusBody) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodesBody) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_HEALTH_EMPTY) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
}

test.describe('#492 /nodes filter by team/tag', () => {
  test('TEAMS: filter=alpha returns EXACTLY {alpha-a, alpha-b} (no leak of empty-team or beta)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_TEAMS, HUB_NODES_TEAMS);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('h1', { hasText: 'Nodes' }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="filter-team"]').first()).toBeVisible({ timeout: 10000 });
    await page.locator('[data-testid="filter-team"]').selectOption('alpha');
    await page.waitForTimeout(500);

    // Assert EXACT alias set — count assertion alone would let a bug
    // that also leaks "no-team" survive (2 alpha + 2 leaks would still
    // == 2 if beta was also excluded).
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('alpha-a');
    expect(bodyText).toContain('alpha-b');
    expect(bodyText).not.toContain('beta-a');
    expect(bodyText).not.toContain('no-team');
  });

  test('TEAMS: filter=__NO_TEAM__ returns EXACTLY {no-team}', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_TEAMS, HUB_NODES_TEAMS);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="filter-team"]').first()).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="filter-team"]').selectOption('__NO_TEAM__');
    await page.waitForTimeout(500);

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('no-team');
    expect(bodyText).not.toContain('alpha-a');
    expect(bodyText).not.toContain('alpha-b');
    expect(bodyText).not.toContain('beta-a');
  });

  test('TAGS: AND semantics — selecting prod+db returns EXACTLY {ab}', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_TAGS, HUB_NODES_TAGS);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="filter-tags-row"]').first()).toBeVisible({ timeout: 15000 });
    // Click both tag chips
    await page.locator('button[data-tag="prod"]').click();
    await page.locator('button[data-tag="db"]').click();
    await page.waitForTimeout(500);

    // Explicit AND hint must appear when >= 2 tags selected
    await expect(page.locator('[data-testid="filter-tags-and-hint"]').first()).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('both-tags');
    expect(bodyText).not.toContain('a-only');
    expect(bodyText).not.toContain('b-only');
    expect(bodyText).not.toContain('no-tags');
    // Round-2 review (通信龙): substring assertions alone can't
    // distinguish "correct 1 result" from "0 results" when the target
    // alias happens to appear elsewhere on the page. Pin exact count
    // via data-node-card (added on both list + grid render modes).
    // Also assert the ONE surviving card is the target — kills any
    // "1 card visible but wrong one" bug.
    await expect(page.locator('[data-node-card]')).toHaveCount(1);
    await expect(page.locator('[data-node-alias="both-tags"]')).toHaveCount(1);
  });

  test('TAGS: AND-empty result — copy echoes the specific filter conditions', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_TAGS, HUB_NODES_TAGS);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-testid="filter-tags-row"]').first()).toBeVisible({ timeout: 15000 });
    // prod + canary — no node has BOTH ('both-tags' has prod+db, 'b-only'
    // has db+canary). AND intersection is empty. This is the exact
    // scenario 通信龙 flagged: silent 0-result looks like a data-sync
    // bug; the copy must echo "no nodes with both prod AND canary".
    await page.locator('button[data-tag="prod"]').click();
    await page.locator('button[data-tag="canary"]').click();
    await page.waitForTimeout(500);

    const bodyText = await page.locator('body').innerText();
    // Filter-echoing empty-state names the specific tags (English locale
    // is the runtime default; also match Chinese as a safety net for
    // locale flips in future).
    expect(bodyText).toMatch(/prod/);
    expect(bodyText).toMatch(/canary/);
    expect(bodyText).toMatch(/No nodes match the current attribute filters|没有节点符合当前属性筛选/);
    // The specific "all of tags: prod AND canary" copy must appear —
    // this is what makes the AND-empty state distinguishable from a
    // data-sync bug (通信龙 review requirement).
    expect(bodyText).toMatch(/all of tags:\s*prod\s+AND\s+canary|同时具有标签\s*prod\s+和\s+canary/);
    // Generic "No nodes match your filters" (older status/search copy)
    // MUST NOT show up when attribute filters are active.
    expect(bodyText).not.toContain('No nodes match your filters');
  });

  test('COLD START: no attrs — team select + tag chip row are hidden', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_COLD, HUB_NODES_COLD);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('h1', { hasText: 'Nodes' }).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // Neither filter control should render — nothing to filter by.
    expect(await page.locator('[data-testid="filter-team"]').count()).toBe(0);
    expect(await page.locator('[data-testid="filter-tags-row"]').count()).toBe(0);

    // Nodes ARE visible (untagged-1, untagged-2).
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('untagged-1');
    expect(bodyText).toContain('untagged-2');
  });
});
