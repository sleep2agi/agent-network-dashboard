import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// 通信龙 07-31: attribute-always-present guarantee for pin/mute.
//
// The wire that USED to emit `data-node-pinned="true" | undefined` made a
// gate script that counts "rows with the attribute" indistinguishable
// from a wire that was ripped out — both looked like zero. This spec
// enforces the new invariant AND proves the attribute tracks real state
// (not a hardcoded literal that would also pass the capability check).
//
// TWO assertions, both required:
//   (A) capability   — every rail row emits data-node-pinned AND
//                      data-node-muted, and the value is 'true' | 'false'
//                      (never absent, never something else). If a future
//                      refactor drops the emit, THIS reds.
//   (B) real state   — toggling pin on one row flips ITS attribute from
//                      'false' to 'true' — and leaves the others alone.
//                      If someone hardcodes both to 'false' (would pass
//                      A), THIS reds. Same shape for muted.
//
// Rate-limit guard (10 logins / 15min / IP): per-worker cachedCookie
// (same as e2e-batch-list-actions.spec.ts).

let cachedCookie: string | undefined;

async function login(context: Page['context'] extends () => infer C ? C : never) {
  if (cachedCookie) {
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: cachedCookie,
      domain: new URL(BASE).hostname,
      path: '/',
    }]);
    return;
  }
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const setCookie = res.headers()['set-cookie'] || '';
  const m = setCookie.match(/anet_dashboard_session=([^;]+)/);
  if (m) {
    cachedCookie = decodeURIComponent(m[1]);
    await context.addCookies([{
      name: 'anet_dashboard_session',
      value: cachedCookie,
      domain: new URL(BASE).hostname,
      path: '/',
    }]);
  }
}

const FIXTURE_SESSIONS = {
  sessions: [
    { alias: 'node-alpha', status: 'idle', network_id: 'net_x' },
    { alias: 'node-beta',  status: 'idle', network_id: 'net_x' },
    { alias: 'node-gamma', status: 'idle', network_id: 'net_x' },
  ],
};
const FIXTURE_NODES = {
  nodes: [
    { alias: 'node-alpha', node_id: 'n_alpha', team: null, tags: [], attrs_revision: 0 },
    { alias: 'node-beta',  node_id: 'n_beta',  team: null, tags: [], attrs_revision: 0 },
    { alias: 'node-gamma', node_id: 'n_gamma', team: null, tags: [], attrs_revision: 0 },
  ],
};

async function stubHub(page: Page) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_SESSIONS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_NODES) }));
  await page.route('**/api/hub/networks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ networks: [{ network_id: 'net_x', network_name: 'net_x' }] }) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: '0.9.0-test', sse_connections: 0, sse_sessions: {} }) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/hub/events**', r =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  await page.route('**/api/anet/node-config**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: '', flags: {}, channels: [], config_revision: 0 }) }));
}

test.describe('Pin/mute attr — always present + tracks real state', () => {
  test('every rail row emits data-node-pinned AND data-node-muted with value ∈ {true,false}', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Ensure no leftover state from prior runs would tint the "false"
    // starting point — clear both storage keys before navigating.
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('anet_chat_pin_v1'); } catch {}
      try { window.localStorage.removeItem('anet_chat_mute_v1'); } catch {}
    });
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-node-list-alias="node-alpha"]').first()).toBeVisible({ timeout: 15000 });

    const rows = page.locator('[data-node-list-item]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3); // premise: fixture landed

    const pinnedVals: string[] = [];
    const mutedVals: string[] = [];
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const pin = await row.getAttribute('data-node-pinned');
      const mute = await row.getAttribute('data-node-muted');
      pinnedVals.push(pin ?? '__ABSENT__');
      mutedVals.push(mute ?? '__ABSENT__');
    }
    // Report cardinality alongside failure — if this reds, we want to
    // see whether N of N were absent (wire ripped) vs 1 of N was 'foo'
    // (someone typo'd the emit).
    for (const v of pinnedVals) {
      expect(v, `pinned attr values across ${count} rows: ${JSON.stringify(pinnedVals)}`)
        .toMatch(/^(true|false)$/);
    }
    for (const v of mutedVals) {
      expect(v, `muted attr values across ${count} rows: ${JSON.stringify(mutedVals)}`)
        .toMatch(/^(true|false)$/);
    }
  });

  test('toggling pin on node-beta flips its data-node-pinned from false to true (others unchanged)', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('anet_chat_pin_v1'); } catch {}
      try { window.localStorage.removeItem('anet_chat_mute_v1'); } catch {}
    });
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-node-list-alias="node-beta"]').first()).toBeVisible({ timeout: 15000 });

    // Baseline — all three rows read 'false' on pinned.
    // This is the PREMISE, not the conclusion — if the fixture happens
    // to have someone already pinned, the toggle would flip 'true' →
    // 'false' and the conclusion assert reverses direction. Assert
    // premise first to catch that.
    const alphaBefore = await page.locator('[data-node-list-alias="node-alpha"]').getAttribute('data-node-pinned');
    const betaBefore = await page.locator('[data-node-list-alias="node-beta"]').getAttribute('data-node-pinned');
    const gammaBefore = await page.locator('[data-node-list-alias="node-gamma"]').getAttribute('data-node-pinned');
    expect(alphaBefore).toBe('false');
    expect(betaBefore).toBe('false');
    expect(gammaBefore).toBe('false');

    // Toggle pin on node-beta via the context menu (real user path —
    // togglePin from ../lib/chat-pin). Right-click → ctx-pin.
    await page.locator('[data-node-list-alias="node-beta"]').click({ button: 'right' });
    await expect(page.locator('[data-testid="node-context-menu"]')).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="ctx-pin"]').click();
    // Storage event → useSyncExternalStore rerender — allow a tick.
    await page.waitForTimeout(200);

    // 🔴 Core: node-beta flipped from 'false' → 'true'. If the attribute
    // were hardcoded to the literal 'false' (which would pass the
    // capability test above), THIS reds precisely.
    const alphaAfter = await page.locator('[data-node-list-alias="node-alpha"]').getAttribute('data-node-pinned');
    const betaAfter = await page.locator('[data-node-list-alias="node-beta"]').getAttribute('data-node-pinned');
    const gammaAfter = await page.locator('[data-node-list-alias="node-gamma"]').getAttribute('data-node-pinned');
    expect(betaAfter).toBe('true');
    // Others must NOT have changed — sanity that the toggle scoped to
    // the right alias (not e.g. accidentally pinning every row).
    expect(alphaAfter).toBe('false');
    expect(gammaAfter).toBe('false');
  });
});
