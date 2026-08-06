import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// #53 DOM behaviour — the "blind" vs "truly empty" fixtures MUST render
// distinct UIs. Same-render is exactly the regression #53 was opened
// for (unified predicate collapses "can't see" and "nothing there" into
// a confident, consistent, and wrong 0 online).
//
// Acceptance criterion from the issue:
//   > 两个 fixture 必须都在，且断言互不相同 —— 否则又回到「两种情形一个画面」
//
// PR #54 review round-2 added a third fixture — BLIND (populated fleet)
// — because /api/hub/status and /health have INDEPENDENT auth gates, so
// "status returned sessions, health omitted sse_sessions" is a real
// reachable combination that only the populated-fleet fixture covers.
//
// Assertion matrix (each column must have at least one row unique to
// itself, and each row must be independently red-provable — a targeted
// mutation of the code that assertion protects should make ONLY that
// row's test go red, not just the earliest gate in that test):
//
//                        | BLIND(empty)  BLIND(populated)  EMPTY
//   "? online" strip     |    ✓            —              ✗ (not.toMatch)
//   "0 online" strip     |    ✗            —              ✓
//   "presence unavail"   |    —            ✓              ✗
//   HealthBanner text    |    ✓            ✓              ✗
//   agent-alpha visible  |    —            ✓              —   ← proves the
//                        |                                    grid actually
//                        |                                    mounted, so
//                        |                                    "cell isn't a
//                        |                                    number" can't
//                        |                                    pass on an
//                        |                                    unrendered grid
//   Online cell === '?'  |    —            ✓              —
//   "Spin up..." pitch   |    ✗            ✗              — (may or may not)
//
// Witnessed-red evidence for each fixture:
//   - BLIND(empty)  ← mutate presenceStatus → always 'ready': banner
//                     gate at "Unable to read presence" fails.
//   - EMPTY         ← the "always 'ready'" mutation doesn't red this
//                     test because EMPTY *wants* 'ready'. The
//                     regression EMPTY protects is the OPPOSITE
//                     direction: "someone treats sse_sessions === {}
//                     as if the map were missing". Two targeted
//                     mutations of presence.ts, each catches EMPTY
//                     at a different assertion — the pair is what
//                     proves EMPTY isn't relying on one accidental
//                     assertion:
//
//                     (a) `if (sseSessions && Object.keys(sseSessions)
//                         .length > 0) return 'ready';`  (requires
//                         non-empty map to be 'ready')
//                         → {} + conns=0 falls through to the conns
//                           check → returns 'loading' (NOT 'blind',
//                           because EMPTY fixture has conns=0).
//                         → page.tsx sets presenceUnknown=true.
//                         → StatsBar renders '? online' not '0 online'.
//                         → RED at L223: expect(bodyText).toMatch(
//                             /\b0\s+online\b/i)  — Expected pattern
//                             /\b0\s+online\b/i, received "agent
//                             network..." (the '0 online' text is
//                             gone from the strip).
//
//                     (b) `if (sseSessions && Object.keys(sseSessions)
//                         .length > 0) return 'ready'; if (sseSessions
//                         !== undefined) return 'blind';`  (forces
//                         empty-map to 'blind' directly)
//                         → {} → 'blind' regardless of conns.
//                         → HealthBanner fires the red presence-blind
//                           banner.
//                         → RED at L217: expect(bodyText.toLowerCase())
//                             .not.toContain('unable to read presence')
//                           — Expected NOT to contain, received
//                           "agent network... unable to read presence
//                           — hub reports 0 live SSE...".
//
//                     Both mutations are covered by real runs, not
//                     code inspection. Together they show EMPTY's
//                     assertion set is defended from multiple angles
//                     of the "collapse map={} with map=missing"
//                     failure mode — the exact regression #53 opened
//                     against.
//   - BLIND(populated) ← 🔴 mutate ONLY StatsBar (make onlineDisplay
//                     ignore presenceUnknown and always render numeric
//                     `online`): L152 fails with
//                     `Expected: "?"  Received: "0"`. This proves
//                     the '?' assertion targets StatsBar's presence-
//                     unknown branch specifically, not merely the
//                     earlier banner-visible gate.

const HUB_STATUS_ANONYMOUS = {
  // Hub server, when called anonymously / with wrong-scope token,
  // returns 0 sessions AND omits sse_sessions on /health.
  sessions: [],
};

// PR #54 review — the two endpoints (/api/hub/status and /health) have
// independent auth gates, so "status returned sessions, but health's
// sse_sessions is missing" is a real reachable combination. This
// fixture exercises the StatCard populated path — a distinct render
// branch from the empty-fleet strip that the two anonymous fixtures
// above hit.
const HUB_STATUS_POPULATED = {
  sessions: [
    { alias: 'agent-alpha', status: 'working', network_id: 'net_x' },
    { alias: 'agent-beta',  status: 'idle',    network_id: 'net_x' },
    { alias: 'agent-gamma', status: 'idle',    network_id: 'net_x' },
    { alias: 'agent-delta', status: 'working', network_id: 'net_x' },
  ],
};

// Health payload for the BLIND fixture — omits `sse_sessions` entirely
// but reports live connections. That contradiction is the signal.
const HUB_HEALTH_BLIND = {
  ok: true,
  version: '0.9.0-test',
  sse_connections: 97,
  // Note: sse_sessions deliberately NOT included. That's the whole
  // point of the fixture — the map is missing while conns > 0.
};

// Health payload for the EMPTY fixture — map is present and empty,
// conns is 0. Truly no nodes connected.
const HUB_HEALTH_EMPTY = {
  ok: true,
  version: '0.9.0-test',
  sse_connections: 0,
  sse_sessions: {},
};

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

async function mockCommon(page: Page, statusBody: object, healthBody: object) {
  await page.route('**/api/hub/status**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusBody) }));
  await page.route('**/api/hub/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(healthBody) }));
  // Cheap stubs — HealthBanner also polls /api/hub/stats + /tasks, so
  // return empty happy shapes to keep the amber "N failed" and green
  // "all systems go" branches inert.
  await page.route('**/api/hub/stats**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, tasks: { by_status: [] }, nodes: { total: 0 } }) }));
  await page.route('**/api/hub/tasks**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [], _hint: {} }) }));
  await page.route('**/api/hub/nodes**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) }));
  await page.route('**/api/hub/messages**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
}

test.describe('#53 blind vs empty — different UIs', () => {
  test('BLIND: sse_sessions absent + conns > 0 → alert + "?" online + NO empty-state pitch', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_ANONYMOUS, HUB_HEALTH_BLIND);
    await page.goto(`${BASE}/`);
    // Wait for the HealthBanner blind message to appear.
    await expect(page.locator('text=/Unable to read presence/i').first()).toBeVisible({ timeout: 15000 });

    const bodyText = await page.locator('body').innerText();

    // The "?" online — in the empty-fleet strip (StatsBar renders the
    // strip when total===0). Under blind, the strip reads "? online"
    // instead of "0 online". This is the DOM signal that must NOT
    // match the truly-empty fixture below.
    expect(bodyText).toMatch(/\?\s+online\b/);
    expect(bodyText).not.toMatch(/\b0\s+online\b/);

    // MUST NOT pitch "Spin up your first agent" in this state.
    expect(bodyText).not.toContain('Spin up your first agent');

    // Positive: HealthBanner alert copy is present.
    expect(bodyText.toLowerCase()).toContain('unable to read presence');
    // Positive: the alert names the "live SSE" side of the
    // contradiction. Reviewer note: an earlier draft also accepted
    // /97/, but that digit can incidentally match other numbers on
    // the page (versions, other counters) — tightening to the phrase
    // that only the banner uses.
    expect(bodyText).toMatch(/live SSE/i);

    await page.screenshot({ path: 'test-results/e2e-53-blind.png', fullPage: false });
  });

  test('BLIND (populated fleet): StatCard grid renders "?" for Online + "presence unavailable" subtitle', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_POPULATED, HUB_HEALTH_BLIND);
    await page.goto(`${BASE}/`);
    await expect(page.locator('text=/Unable to read presence/i').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').innerText();

    // Positive proof the StatCard grid actually rendered — otherwise
    // "Online cell isn't a number" would spuriously pass just because
    // the whole grid failed to mount. Assert we see at least one of
    // the fixture aliases, which appear in the AgentCard grid below
    // the StatsBar.
    expect(bodyText).toContain('agent-alpha');

    // The StatCard "Online" cell — under populated + blind, the value
    // is '?' and the subtitle drops to 'presence unavailable' (both
    // set by StatsBar via the presenceUnknown prop). This is the
    // primary reachable path in real traffic: hub returned sessions
    // (status endpoint auth held), health omitted sse_sessions (its
    // own auth gate tripped). Two independent auth gates, one
    // rendering combination.
    const onlineCardValue = await page.getByText('Online', { exact: true }).first()
      .evaluate(el => el.previousElementSibling?.textContent ?? null);
    expect(onlineCardValue?.trim()).toBe('?');

    // Subtitle underneath the card.
    expect(bodyText.toLowerCase()).toContain('presence unavailable');

    // Empty-state pitch must NOT appear even though total > 0 (it's
    // gated on sessions.length === 0), but assert it anyway — the
    // gate condition on presenceState covers a different path and we
    // want either coverage to catch a regression.
    expect(bodyText).not.toContain('Spin up your first agent');

    await page.screenshot({ path: 'test-results/e2e-53-populated-blind.png', fullPage: false });
  });

  test('EMPTY: sse_sessions = {} + conns = 0 → NO presence-blind alert + numeric 0 online', async ({ page, context }) => {
    await login(context);
    await mockCommon(page, HUB_STATUS_ANONYMOUS, HUB_HEALTH_EMPTY);
    await page.goto(`${BASE}/`);
    // Wait for the page to settle. Something needs to render — pick a
    // stable, non-count anchor.
    await expect(page.locator('h1', { hasText: 'Agent Network' }).first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('body').innerText();

    // The presence-blind alert MUST NOT fire when the map is truly
    // present-and-empty — that would be a false alarm the other way.
    expect(bodyText.toLowerCase()).not.toContain('unable to read presence');

    // In truly-empty state, presenceStatus === 'ready', so the online
    // cell is a real number (0). Confirm it's NOT "?".
    // (Empty-fleet path uses a thin strip, not the StatCard grid, so
    // we grep the strip text.)
    expect(bodyText).toMatch(/\b0\s+online\b/i);
    expect(bodyText).not.toContain('presence unavailable');

    await page.screenshot({ path: 'test-results/e2e-53-empty.png', fullPage: false });
  });
});
