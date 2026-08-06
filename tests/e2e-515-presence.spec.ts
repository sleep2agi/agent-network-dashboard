import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// #515 regression test: stats card / sidebar / topology legend must show
// the SAME "online" count when fed identical hub state. Historically each
// site computed its own predicate (`isOnline = ...`) and they drifted
// (page 95, sidebar 99, legend 99) — the fix extracts a single shared
// presence.isOnline() in app/lib/presence.ts.
//
// SCOPE OF THIS TEST — this proves "given the same data, the 3 DOM
// consumers render the same number", AND that number is the SSE-reachable
// count (not the status-based count). It does NOT prove the wire fetch
// gets sse_sessions from the right upstream endpoint — for that, see the
// production-dashboard "before" screenshot referenced in the PR body and
// the deploy-time smoke test. See memory
// feedback_unit_mock_hides_wire_shape_bugs for why one class of evidence
// doesn't cover the other.
//
// Fixture design (deliberately asymmetric):
//   - SSE-reachable count differs from status-based count in ABSOLUTE
//     value, so `expect(x).toBe(EXPECTED)` catches a mutation of the
//     shared predicate (finding: card=sidebar=legend but wrong number)
//     as well as drift (finding: two of three read the same, one different).
//   - Includes a `SSE:0` node to gate the `> 0` fix from PR #52 round 2
//     (findings 1) — a `!== undefined` predicate would count agent-06.

const FIXTURE_STATUS = {
  sessions: [
    // present in SSE map AND status alive
    { alias: 'agent-01', status: 'working', network_id: 'net_a' },
    { alias: 'agent-02', status: 'idle',    network_id: 'net_a' },
    // present in SSE map but hub row is stale — SSE wins
    { alias: 'agent-03', status: 'offline', network_id: 'net_a' },
    // NOT in SSE map, hub row still says working (the classic zombie)
    { alias: 'agent-04', status: 'working', network_id: 'net_a' },
    // NOT in SSE map, hub row still says idle
    { alias: 'agent-05', status: 'idle',    network_id: 'net_a' },
    // SSE map value is literally 0 (dead-connection edge from an older
    // hub that didn't clean up empty client arrays; #515 round-2
    // finding 1). Correct behaviour: NOT online.
    { alias: 'agent-06', status: 'working', network_id: 'net_a' },
  ],
};

const FIXTURE_HEALTH = {
  ok: true,
  version: '0.9.0-test',
  sessions: 6,
  sse_connections: 3,
  sse_sessions: {
    'net_a:agent-01': 1,
    'net_a:agent-02': 1,
    'net_a:agent-03': 1,
    'net_a:agent-06': 0,  // dead-connection edge — MUST NOT count as online
  },
  uptime: 1,
};

// SSE-reachable with count > 0: agent-01, 02, 03 = 3
// Status-based (retired): agent-01, 02, 04, 05, 06 = 5
// `sseCountFor !== undefined` (finding 1 bug): 01, 02, 03, 06 = 4
// Under status mutation → all three consumers agree on 5, absolute
// assertion catches. Under `!== undefined` regression → all three
// agree on 4, absolute assertion catches too. Under drift (one
// consumer reverts to inline old) → one reads 5, others read 3.
const EXPECTED_ONLINE = 3;

async function login(context: Page['context'] extends () => infer C ? C : never) {
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const setCookie = res.headers()['set-cookie'] || '';
  const match = setCookie.match(/anet_dashboard_session=([^;]+)/);
  if (match) {
    const domain = new URL(BASE).hostname;
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: decodeURIComponent(match[1]),
      domain,
      path: '/',
    }]);
  }
}

async function mockHubEndpoints(page: Page) {
  await page.route('**/api/hub/status**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_STATUS) });
  });
  await page.route('**/api/hub/health', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_HEALTH) });
  });
  await page.route('**/api/hub/nodes**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) });
  });
  await page.route('**/api/hub/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [], _hint: {} }) });
  });
  await page.route('**/api/hub/stats**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.route('**/api/hub/messages**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) });
  });
}

test.describe('#515 presence — one online count everywhere', () => {
  test('stats card / sidebar / topology legend all show the same number', async ({ page, context }) => {
    await login(context);
    await mockHubEndpoints(page);
    await page.goto(`${BASE}/`);
    await expect(page.locator('text=/\\d+\\s*\\/\\s*\\d+\\s+online/i').first()).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);

    // Structural anchors — body-text regex is too greedy across the
    // multiple "N Online" phrases on the page.
    const cardText = await page.getByText('Online', { exact: true }).first()
      .evaluate(el => el.previousElementSibling?.textContent ?? null);
    const sidebarText = await page.getByRole('link', { name: /Agent Network/i }).first().innerText();
    const sidebarMatch = sidebarText.match(/(\d+)\s*\/\s*\d+\s+online/i);
    const legendName = await page.getByRole('link', { name: /^\d+\s+online$/i }).first().getAttribute('aria-label')
      || await page.getByRole('link', { name: /^\d+\s+online$/i }).first().innerText();
    const legendMatch = legendName.match(/(\d+)/);

    const readings = {
      card: cardText ? Number(cardText.trim()) : null,
      sidebar: sidebarMatch ? Number(sidebarMatch[1]) : null,
      legend: legendMatch ? Number(legendMatch[1]) : null,
    };

    console.log('#515 presence readings:', JSON.stringify(readings));

    // Strict equality per #515 acceptance: no tolerance, no `>0` sanity.
    // The absolute value catches "shared predicate regressed" (all three
    // agree but wrong); the pairwise equality catches "one consumer
    // reverted to inline old predicate" (drift).
    expect(readings.card).toBe(EXPECTED_ONLINE);
    expect(readings.sidebar).toBe(EXPECTED_ONLINE);
    expect(readings.legend).toBe(EXPECTED_ONLINE);
    expect(readings.card).toBe(readings.sidebar);
    expect(readings.sidebar).toBe(readings.legend);

    await page.screenshot({
      path: 'test-results/e2e-515-three-numbers-agree.png',
      fullPage: false,
    });
  });
});
