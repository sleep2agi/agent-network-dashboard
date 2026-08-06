import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// Sidebar 3rd mode ('icon-rail', Feishu-style) — 3 tests per 通信龙 brief:
//   1. Renders correctly (mode attr + width class + no text + aria-labels)
//   2. Toggle cycles expanded → collapsed → icon-rail → expanded AND
//      localStorage persists across a fresh page context
//   3. Unread badge appears on the correct nav item when there are
//      unread messages (data pulled from mocked /api/hub/messages —
//      useChatUnread's real data path)
//
// NOT touched here — #492 / Stage A / Stage B tests. This file is
// scoped to Sidebar only; if any assertion needs an existing testid,
// it uses the ones already declared on the Sidebar element itself.

// Login cache — the dashboard's rate-limit is 10 logins / 15 min / IP
// (通信龙 07-31). Every test in this file logs in once per worker, and
// subsequent tests reuse the cached cookie value via context.addCookies.
// A per-file suite of 4 tests × 1 login each was fine on cold cache but
// combined with rerun-during-dev-iteration it walked us straight into
// the ceiling. Module-level var scopes per-Playwright-worker (each
// worker = fresh Node process), so parallel workers still each get one
// login. Cap workers via CLI to avoid parallel bursts.
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

async function stubHub(page: Page, messages: object[] = []) {
  // Minimum surface — Sidebar itself doesn't need most of these but
  // pages it's mounted next to might, and we want the page to render
  // past the loading skeleton so the sidebar is measurable.
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
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages }) }));
}

test.describe('Sidebar icon-rail (3rd mode)', () => {
  test('icon-rail mode renders w-14 + no text labels + aria-labels on every nav item', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Pre-set mode BEFORE navigation so we test the render path
    // straight into icon-rail, not the cycle path.
    await page.addInitScript(() => window.localStorage.setItem('anet-sidebar-mode', 'icon-rail'));
    await page.goto(`${BASE}/`);
    // Sidebar always renders; the mode attribute is the switch.
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'icon-rail', { timeout: 15000 });
    // Width — Tailwind w-14 = 3.5rem = 56px at default root size.
    // Assert numerically rather than by class to survive class-name
    // refactors.
    const w = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeGreaterThanOrEqual(48);
    expect(w).toBeLessThanOrEqual(64);
    // No visible text labels on nav items — icon-only. Test asserts
    // that the aria-label carries semantic name (accessibility) while
    // the visible text of each item is empty/whitespace.
    const navItems = page.locator('[data-nav-item][data-nav-href]');
    const count = await navItems.count();
    expect(count).toBeGreaterThanOrEqual(6);  // Overview/Tasks/Nodes/Servers/Providers/Admin at minimum
    for (let i = 0; i < count; i++) {
      const item = navItems.nth(i);
      const aria = await item.getAttribute('aria-label');
      expect(aria, `nav item #${i} must have aria-label`).toBeTruthy();
      const visibleText = (await item.innerText()).trim();
      // "innerText" for a link with only an <svg> child returns empty
      // or newline — assert it's not the visible label text.
      expect(visibleText.length).toBeLessThanOrEqual(3);  // '', or a badge digit
    }
  });

  test('cycle toggle: expanded → collapsed → icon-rail → expanded, and localStorage updates', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Seed the starting point explicitly instead of relying on the
    // default. 07-31 flipped the default from 'expanded' to
    // 'icon-rail' — this test asserts the CYCLE mechanic (walks the
    // three modes and updates localStorage), not the default choice,
    // so we seed 'expanded' up front to keep the assertion sequence
    // stable across default flips.
    await page.addInitScript(() => window.localStorage.setItem('anet-sidebar-mode', 'expanded'));
    await page.goto(`${BASE}/`);
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'expanded', { timeout: 15000 });

    // Click 1 → collapsed
    await page.locator('[data-testid="sidebar-mode-cycle"]').click();
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'collapsed');
    expect(await page.evaluate(() => window.localStorage.getItem('anet-sidebar-mode'))).toBe('collapsed');

    // Click 2 → icon-rail
    await page.locator('[data-testid="sidebar-mode-cycle"]').click();
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'icon-rail');
    expect(await page.evaluate(() => window.localStorage.getItem('anet-sidebar-mode'))).toBe('icon-rail');

    // Click 3 → back to expanded (cycle wraps)
    await page.locator('[data-testid="sidebar-mode-cycle"]').click();
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'expanded');
    expect(await page.evaluate(() => window.localStorage.getItem('anet-sidebar-mode'))).toBe('expanded');
  });

  test('unread badge appears on /nodes nav only in icon-rail mode, and matches badgeLabel(totalUnread)', async ({ page, context }) => {
    await login(context);
    // 3 unread messages from a non-self alias — useChatUnread reads
    // /api/hub/messages, filters out self-sent and already-read
    // (localStorage is empty → nothing read yet), then sums into
    // totalUnread. Fresh localStorage means all 3 count.
    // useChatUnread uses from_alias / to_alias (NOT from_session), and
    // the message MUST be addressed TO a userish name ('admin' /
    // 'dashboard' / '') and FROM a non-userish alias — this is the
    // "message for the current operator, not fleet-chatter" filter.
    //
    // 🔴 Also: readStoredMap auto-seeds a `__baseline` = new Date() on
    // first read (chat-unread.ts:55-63 — synchronous "first-visit
    // floor" to prevent a badge storm on first login). If our mock
    // messages have `created_at <= baseline`, they'd be treated as
    // "already read". So future-date them by 1 minute — well past the
    // baseline set during hook init.
    const futureIso = new Date(Date.now() + 60_000).toISOString();
    const msgs = [
      { id: 'm1', from_alias: 'peer-a', to_alias: 'admin', created_at: futureIso, content: 'ping 1' },
      { id: 'm2', from_alias: 'peer-b', to_alias: 'admin', created_at: futureIso, content: 'ping 2' },
      { id: 'm3', from_alias: 'peer-a', to_alias: 'admin', created_at: futureIso, content: 'ping 3' },
    ];
    await stubHub(page, msgs);
    await page.addInitScript(() => {
      window.localStorage.setItem('anet-sidebar-mode', 'icon-rail');
      // Clear any stray chat-read baselines so all mock messages count.
      Object.keys(window.localStorage)
        .filter(k => k.startsWith('anet_chat_read_v1:'))
        .forEach(k => window.localStorage.removeItem(k));
    });
    await page.goto(`${BASE}/`);
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'icon-rail', { timeout: 15000 });

    // Give the SWR fetch + unread computation a moment.
    await page.waitForTimeout(1500);

    // Badge attribute on the /nodes nav item — count as data-badge.
    // Also assert the visible red pill exists with the right label.
    const nodesNav = page.locator('[data-nav-item][data-nav-href="/nodes"]');
    const badgeAttr = await nodesNav.getAttribute('data-badge');
    expect(badgeAttr, 'nodes nav should carry data-badge in icon-rail with unread > 0').toBe('3');
    const badge = nodesNav.locator('[data-nav-badge]');
    await expect(badge).toHaveText('3');

    // Sibling assertion: an entry with NO unread (e.g. /admin) MUST
    // NOT carry the data-badge attribute. This is the exclusion side
    // of the coverage — without it, a bug that puts the badge on all
    // items would pass the badge=3 check silently.
    const adminNav = page.locator('[data-nav-item][data-nav-href="/admin"]');
    expect(await adminNav.getAttribute('data-badge')).toBeNull();
    expect(await adminNav.locator('[data-nav-badge]').count()).toBe(0);
  });

  // 通信龙 07-31 round-1 feedback — "断言'名字文本不可见'是弱的，组件
  // 整个没渲染出来那条也会绿。必配同源正向断言 (feedback_silent_
  // failure_needs_independent_review)." This test is that companion:
  // in EXPANDED mode the labels ARE visible with the exact text
  // ("Overview" / "Tasks" / ...) AND the sidebar is measurably WIDER
  // than icon-rail. Without this, test 1 could pass on a bug where
  // the whole nav failed to mount (0 items = 0 visible labels = pass).
  test('symmetry — expanded shows labels visibly, icon-rail hides them, widths ordered, item count preserved', async ({ page, context }) => {
    await login(context);
    await stubHub(page);

    // Round 1 — start EXPANDED, count items + assert labels visible.
    await page.addInitScript(() => window.localStorage.setItem('anet-sidebar-mode', 'expanded'));
    await page.goto(`${BASE}/`);
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'expanded', { timeout: 15000 });

    const expandedWidth = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    const expandedItemCount = await page.locator('[data-nav-item]').count();
    // Sanity — expected 7 items in NAV_ITEMS (Overview through Settings).
    expect(expandedItemCount).toBeGreaterThanOrEqual(6);
    // Positive label visibility — at least one KNOWN label must be
    // present in the visible text of its nav item. This kills the
    // "nav failed to mount" false green.
    const overviewNav = page.locator('[data-nav-item][data-nav-href="/"]');
    await expect(overviewNav).toContainText('Overview');
    const tasksNav = page.locator('[data-nav-item][data-nav-href="/tasks"]');
    await expect(tasksNav).toContainText('Tasks');

    // Round 2 — cycle to icon-rail via the toggle button (2 clicks:
    // expanded → collapsed → icon-rail). page.reload() would re-run
    // addInitScript and clobber the localStorage we set, so we use
    // in-place mode changes instead.
    await page.locator('[data-testid="sidebar-mode-cycle"]').click();
    await page.locator('[data-testid="sidebar-mode-cycle"]').click();
    await expect(page.locator('[data-anet-sidebar="true"]')).toHaveAttribute('data-sidebar-mode', 'icon-rail', { timeout: 15000 });

    const railWidth = await page.locator('[data-anet-sidebar="true"]').first().evaluate(el => el.getBoundingClientRect().width);
    const railItemCount = await page.locator('[data-nav-item]').count();
    // Transitivity: same nav items exist, just collapsed. Kills the
    // "icon-rail dropped nav items" bug that would otherwise render
    // as "text absent" (which the "no visible text" assertion would
    // spuriously interpret as success).
    expect(railItemCount).toBe(expandedItemCount);
    // Width delta must be REAL — >100px difference is the min anyone
    // could reasonably call "narrower". Numeric assertion so a bug
    // that leaves the class but breaks the width still reds.
    expect(expandedWidth - railWidth).toBeGreaterThan(100);
    // 🔴 Counting assertion FIRST (通信龙 07-31 R3 feedback: witnessed-
    // red should show numbers, not just "expected true got false").
    // Count how many nav items in icon-rail mode have any of the
    // known labels visible in their rendered innerText.
    //   correct value  = 0
    //   mutation "labels leak back" = N (== nav item count)
    // Fires BEFORE the substring assertion below so a "labels leaked"
    // regression reds here with the exact leak count, not with a
    // substring hit that hides the magnitude.
    const KNOWN_LABELS = ['Overview', 'Tasks', 'Nodes', 'Servers', 'Providers', 'Admin', 'Settings'];
    const visibleLabelCount = await page.locator('[data-nav-item]').evaluateAll((nodes, labels) => {
      return nodes.filter(n => {
        const text = (n as HTMLElement).innerText.trim();
        return (labels as string[]).some(l => text.includes(l));
      }).length;
    }, KNOWN_LABELS);
    expect(visibleLabelCount).toBe(0);

    // Substring narrow-check on a single well-known item — same
    // invariant, redundant but useful signal on which item leaked.
    const nodesNav = page.locator('[data-nav-item][data-nav-href="/nodes"]');
    const visibleText = (await nodesNav.innerText()).trim();
    expect(visibleText).not.toContain('Nodes');
    expect(await nodesNav.getAttribute('aria-label')).toBe('Nodes');
  });
});
