import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// 08-09 update — Sidebar default flipped back to 'expanded' for NEW
// visitors (Vincent「左侧标签栏要显示完全 / 都没有展开」), reversing the
// 07-31 'icon-rail' default. It still MUST NOT overwrite an existing
// choice in localStorage. The two are entangled: the initial `useState`
// sets the default (now 'expanded') and the useEffect that reads
// `anet-sidebar-mode` preserves an existing user's choice. NB: because
// the default is now 'expanded', the preservation witnessed-red rides on
// Test C (seeds 'collapsed'), not Test B — see plan at end of file.
//
// 通信龙 07-31 review:
// > 只写第一条是不够的 — 第二条正是"改默认"最容易顺手破坏的东西，
// > 而且破坏了不会报错，用户只会觉得"这破玩意儿又变回去了"
//
// So we assert BOTH sides. Witnessed-red plan documented at the end
// of this file — mutation "remove the useEffect body" leaves test A
// green but reds test B, which is exactly the coverage claim.

// Per-worker login cache — the dashboard rate-limits logins to
// 10 / 15min / IP; per e2e-sidebar-icon-rail.spec.ts. Same pattern.
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

async function stubHub(page: Page) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) }));
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
}

test.describe('Sidebar default (07-31)', () => {
  test('A — first-visit user (no localStorage) gets expanded by default, width ~208px', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Make sure NOTHING is in localStorage — first-visit simulation.
    await page.addInitScript(() => window.localStorage.removeItem('anet-sidebar-mode'));
    await page.goto(`${BASE}/`);
    // 08-09 (Vincent「左侧标签栏要显示完全/都没有展开」): default flipped back
    // to 'expanded' so new visitors see icons + labels in full.
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'expanded', { timeout: 15000 });
    // Width = expanded (w-52 = 208px), NOT the 56px icon-rail. Sub-pixel
    // wiggle allowed (rounding / scrollbar).
    const w = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeGreaterThan(180);
    expect(w).toBeLessThanOrEqual(216);
    // Labels visible — proves it's really expanded, not a render failure.
    await expect(page.locator('[data-nav-item][data-nav-href="/"]')).toContainText('Overview');
  });

  test('B — returning user with expanded already stored is NOT overwritten', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Seed the "existing user chose expanded" scenario — this is
    // exactly the case a naive "just change the default" would break.
    await page.addInitScript(() => window.localStorage.setItem('anet-sidebar-mode', 'expanded'));
    await page.goto(`${BASE}/`);
    // The rendered mode MUST honor stored choice, not overwrite it.
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'expanded', { timeout: 15000 });
    // Width should match expanded (w-52 = ~208px), NOT icon-rail (56px).
    const w = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeGreaterThan(180);
    // Sibling positive assertion — labels visible (proves it's actually
    // expanded, not "sidebar failed to render past hydration"). Without
    // this, a bug that fails to render the whole aside would still
    // satisfy "not icon-rail width".
    await expect(page.locator('[data-nav-item][data-nav-href="/"]')).toContainText('Overview');
    // localStorage still holds 'expanded' after mount — not silently
    // rewritten to something else.
    expect(await page.evaluate(() => window.localStorage.getItem('anet-sidebar-mode'))).toBe('expanded');
  });

  test('C — returning user with collapsed already stored is NOT overwritten either', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    await page.addInitScript(() => window.localStorage.setItem('anet-sidebar-mode', 'collapsed'));
    await page.goto(`${BASE}/`);
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'collapsed', { timeout: 15000 });
    const w = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    // w-16 = 64px
    expect(w).toBeGreaterThanOrEqual(56);
    expect(w).toBeLessThanOrEqual(80);
  });
});

// Witnessed-red plan (executed manually, documented here for future
// readers per 通信龙's "witnessed-red should show numbers" rule):
//
// Mutation: comment out the useEffect body in Sidebar.tsx that reads
// localStorage — the store-preservation path.
//
//   useEffect(() => {
//     // try {
//     //   const v = localStorage.getItem(SIDEBAR_MODE_STORAGE);
//     //   if (v && (SIDEBAR_MODES as readonly string[]).includes(v)) setMode(v as SidebarMode);
//     // } catch {}
//   }, []);
//
// Expected under mutation (after 08-09 default flip to 'expanded'):
//   - Test A stays GREEN. No LS; default 'expanded' still applies.
//   - Test B now also stays GREEN — the seeded value 'expanded' equals
//     the new default, so removing the read is indistinguishable here.
//     B is therefore VACUOUS for the preservation claim under this
//     default and is kept only as an expanded-renders positive smoke.
//   - Test C REDS. Expected data-sidebar-mode='collapsed', received
//     'expanded' (default); width reds (Expected ~64, Received ~208).
//
// So the preservation witnessed-red now rides ENTIRELY on Test C, whose
// seeded value ('collapsed') differs from the default. If C ever stops
// reding under this mutation, the useEffect preservation path is dead.
