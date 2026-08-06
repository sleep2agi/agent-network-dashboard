import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// Stage B — persistent right chat pane on /nodes + /nodes/[alias] routing.
// Guarantees under test:
//   1. Clicking a node renders the chat INLINE in a persistent right pane
//      (no full-screen overlay on desktop), and the URL becomes
//      /nodes/<encoded alias> without a page reload.
//   2. Clicking another node swaps the pane in place — still exactly ONE
//      pane, new alias, new URL.
//   3. /nodes/<alias> direct load (deep link) opens with that node selected;
//      Chinese aliases decode exactly once.
//   4. Close returns to /nodes and unselects.
//   5. < 768px falls back to the pre-B behavior: full-screen overlay,
//      no right pane.
//   6. #492 hook invariance: the pane adds ZERO [data-node-card] /
//      [data-node-alias] elements — exact-count assertions stay valid.

const CN_ALIAS = '通测中文马';

const HUB_STATUS = {
  sessions: [
    { alias: 'stage-b-1', status: 'idle', network_id: 'net_x' },
    { alias: 'stage-b-2', status: 'working', network_id: 'net_x' },
    { alias: CN_ALIAS, status: 'idle', network_id: 'net_x' },
  ],
};
const HUB_NODES = {
  nodes: [
    { alias: 'stage-b-1', team: null, tags: [] },
    { alias: 'stage-b-2', team: null, tags: [] },
    { alias: CN_ALIAS, team: null, tags: [] },
  ],
};
const HUB_HEALTH = {
  ok: true,
  version: '0.9.0-test',
  sse_connections: 3,
  sse_sessions: {
    'net_x:stage-b-1': 1,
    'net_x:stage-b-2': 1,
    [`net_x:${CN_ALIAS}`]: 1,
  },
};

// The dashboard login route rate-limits to 10 attempts / 15 min / IP
// (app/lib/rate-limit.ts). Per-test logins across the combined suite
// (stage-a 3 + e2e-9 5 + this file) blow that budget and late tests get
// 429 → stuck on the sign-in page. Login ONCE per worker and reuse the
// session cookie — it's the same password-derived value every time.
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


// #Vincent auto-select (07-31): desktop /nodes now auto-selects the first
// conversation. Tests that exercise the UNSELECTED table-on-entry state
// opt into the persisted manage-view mode — the product's explicit doorway
// to that state — instead of weakening assertions.
async function manageMode(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '1'));
}

const pane = (page: Page) => page.locator('[data-testid="chat-pane"]');
const card = (page: Page, alias: string) => page.locator(`[data-node-card][data-node-alias="${alias}"]`);

test.describe('Stage B — persistent chat pane + /nodes/[alias] routing', () => {
  test('clicking a node renders chat inline in the right pane and rewrites the URL', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await manageMode(page);
    await page.goto(`${BASE}/nodes`);
    await expect(card(page, 'stage-b-1')).toBeVisible({ timeout: 15000 });

    await card(page, 'stage-b-1').click();
    await expect(pane(page)).toBeVisible();
    await expect(pane(page)).toHaveAttribute('data-chat-alias', 'stage-b-1');
    // Inline, not overlay: the overlay shell's slide-in drawer must NOT exist.
    await expect(page.locator('.animate-slide-in')).toHaveCount(0);
    // Chat body actually mounted inside the pane (composer textarea).
    await expect(pane(page).locator('textarea')).toBeVisible();
    // URL rewritten shallowly — same document, no reload.
    await expect(page).toHaveURL(`${BASE}/nodes/stage-b-1`);
  });

  test('clicking another node swaps the SAME pane in place (still exactly one)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await manageMode(page);
    await page.goto(`${BASE}/nodes`);
    await expect(card(page, 'stage-b-1')).toBeVisible({ timeout: 15000 });

    await card(page, 'stage-b-1').click();
    await expect(pane(page)).toHaveAttribute('data-chat-alias', 'stage-b-1');
    // #Stage C: once selected the table is gone — switching happens via the
    // rail (the WeChat gesture this whole track is about).
    await page.locator('[data-node-list-item][data-node-list-alias="stage-b-2"]').click();
    await expect(pane(page)).toHaveAttribute('data-chat-alias', 'stage-b-2');
    await expect(pane(page)).toHaveCount(1);
    await expect(page).toHaveURL(`${BASE}/nodes/stage-b-2`);
  });

  test('deep link /nodes/<alias> opens preselected; Chinese alias decodes exactly once', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/${encodeURIComponent(CN_ALIAS)}`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await expect(pane(page)).toHaveAttribute('data-chat-alias', CN_ALIAS);
    // Rail marks the same node selected (Stage A hook, untouched).
    await expect(page.locator(`[data-node-list-item][data-node-list-alias="${CN_ALIAS}"]`)).toHaveAttribute('data-selected', 'true');
  });

  test('close button unselects and returns the URL to /nodes', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="chat-pane-close"]').click();
    await expect(pane(page)).toHaveCount(0);
    await expect(page).toHaveURL(`${BASE}/nodes`);
  });

  test('< 768px: two-level nav — list fullscreen, tap opens chat as a PAGE (no overlay), URL-addressable', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '0'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/nodes`);
    // Level 1: conversation list fullscreen; the table does NOT render;
    // and mobile does NOT auto-select (desktop-only behavior — 通信龙:
    // two correct behaviors, don't test one shape with the other's
    // assertions). URL must stay /nodes.
    const rail = page.locator('[data-testid="node-list-rail"]');
    await expect(rail).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(900);
    await expect(page).toHaveURL(`${BASE}/nodes`);
    const railBox = await rail.boundingBox();
    expect(Math.abs(railBox!.width - 390)).toBeLessThanOrEqual(2);
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
    await expect(page.locator('[data-node-list-item]')).toHaveCount(3);

    // Level 2: tap → chat page (not overlay), back arrow present.
    await page.locator('[data-node-list-item][data-node-list-alias="stage-b-1"]').click();
    await expect(pane(page)).toBeVisible();
    await expect(page.locator('.animate-slide-in')).toHaveCount(0);
    const paneBox = await pane(page).boundingBox();
    expect(Math.abs(paneBox!.width - 390)).toBeLessThanOrEqual(2);
    await expect(rail).toHaveCount(0); // one level at a time
    await expect(page.locator('[data-testid="chat-back"]')).toBeVisible();
    await expect(page).toHaveURL(`${BASE}/nodes/stage-b-1`);

    // Back arrow returns to the list.
    await page.locator('[data-testid="chat-back"]').click();
    await expect(rail).toBeVisible();
    await expect(page).toHaveURL(`${BASE}/nodes`);
  });

  test('< 768px: back (arrow AND browser) restores list scroll position within 200px', async ({ page, context }) => {
    await login(context);
    await mockWide(page); // 60 nodes — enough to have a real scroll offset
    await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '0'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/nodes`);
    const scroll = page.locator('[data-testid="node-list-scroll"]');
    await expect(page.locator('[data-node-list-item]')).toHaveCount(60, { timeout: 15000 });

    const target = page.locator('[data-node-list-item][data-node-list-alias="stage-d-50"]');
    await target.scrollIntoViewIfNeeded();
    const before = await scroll.evaluate(el => el.scrollTop);
    expect(before).toBeGreaterThan(500); // sanity: we really are deep in the list

    await target.click();
    await expect(pane(page)).toBeVisible();
    await page.locator('[data-testid="chat-back"]').click();
    await expect(scroll).toBeVisible();
    const afterArrow = await scroll.evaluate(el => el.scrollTop);
    expect(Math.abs(afterArrow - before)).toBeLessThanOrEqual(200);

    // Browser back behaves the same (判据: 行为一致).
    await target.click();
    await expect(pane(page)).toBeVisible();
    await page.goBack();
    await expect(scroll).toBeVisible();
    const afterBack = await scroll.evaluate(el => el.scrollTop);
    expect(Math.abs(afterBack - before)).toBeLessThanOrEqual(200);
  });

  test('< 768px: manage mode still reaches the table, with a way back to conversations', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.addInitScript(() => window.localStorage.setItem('anet-nodes-manage-view', '1'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/nodes`);
    // Fact-side positive: the table is genuinely there in manage mode
    // (guards against "mobile hides table" being green because the table
    // broke everywhere).
    await expect(page.locator('[data-node-card]')).toHaveCount(3, { timeout: 15000 });
    await expect(page.locator('[data-testid="manage-view-toggle-mobile"]')).toBeVisible();

    await page.locator('[data-testid="manage-view-toggle-mobile"]').click();
    await expect(page.locator('[data-testid="node-list-rail"]')).toBeVisible();
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
  });

  test('slow-load regression: 1.5s-delayed first /api/hub/status on a deep link → no crash page', async ({ page, context }) => {
    await login(context);
    let delayed = false;
    await page.route('**/api/hub/status**', async r => {
      if (!delayed) { delayed = true; await new Promise(res => setTimeout(res, 1500)); }
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HUB_STATUS) });
    });
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

    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=This page couldn’t load")).toHaveCount(0);
    // #Stage C: selected deep link renders list+chat (no table) — anchor on the rail.
    await expect(page.locator('[data-node-list-item][data-node-list-alias="stage-b-1"]')).toBeVisible({ timeout: 15000 });
  });

  test('#Stage C: selected = list+chat (table gone), unselected = table back — BOTH directions asserted', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await manageMode(page);
    await page.goto(`${BASE}/nodes`);
    // Direction 1 (positive, same source): unselected /nodes renders the table.
    await expect(card(page, 'stage-b-1')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-node-card]')).toHaveCount(3);

    await card(page, 'stage-b-1').click();
    await expect(pane(page)).toBeVisible();
    // Direction 2: selected state renders ZERO table cards — the middle
    // column yields to the chat — while the rail still lists everything.
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
    await expect(page.locator('[data-node-list-item]')).toHaveCount(3);

    // And back: closing restores the table (proves absence above was the
    // layout rule, not the table breaking).
    await page.locator('[data-testid="chat-pane-close"]').click();
    await expect(page.locator('[data-node-card]')).toHaveCount(3);
  });

  test('#Stage C: dense-view user (rail hidden) selecting a node force-shows the rail', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await manageMode(page);
    await page.addInitScript(() => window.localStorage.setItem('anet-nodes-rail', '0'));
    await page.goto(`${BASE}/nodes`);
    await expect(card(page, 'stage-b-1')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-testid="node-list-rail"]')).toHaveCount(0);

    await card(page, 'stage-b-1').click();
    // list+chat layout NEEDS the rail — it's the only way to switch nodes.
    await expect(page.locator('[data-testid="node-list-rail"]')).toBeVisible();
    await expect(pane(page)).toBeVisible();
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Stage D — the page never scrolls; each column scrolls itself.
// 通信龙's production measurement after Stage C: page height 11806px,
// rail 11775px (199 rows, no own scroll), chat-pane sticky top=-791px —
// sticky referenced ancestors with overflow auto while the DOCUMENT was
// the actual scroller, so the pane scrolled away and the chat looked
// dead. Fix under test: root h-[100dvh] overflow-hidden, rail + middle
// + chat each overflow-y-auto, sticky gone. Wide fixture (60 nodes) so
// the assertions actually discriminate — with 3 nodes the page was
// never tall enough to fail.
// Plus SPEC.md §2 column base colors: list #0F1320, chat #141826,
// 1px rgba(255,255,255,0.06) between them.
// ─────────────────────────────────────────────────────────────────────
const WIDE_N = 60;
const WIDE_STATUS = {
  sessions: Array.from({ length: WIDE_N }, (_, i) => ({
    alias: `stage-d-${i + 1}`, status: 'idle', network_id: 'net_x',
  })),
};
const WIDE_NODES = {
  nodes: Array.from({ length: WIDE_N }, (_, i) => ({
    alias: `stage-d-${i + 1}`, team: null, tags: [],
  })),
};
const WIDE_HEALTH = {
  ok: true, version: '0.9.0-test', sse_connections: WIDE_N,
  sse_sessions: Object.fromEntries(
    Array.from({ length: WIDE_N }, (_, i) => [`net_x:stage-d-${i + 1}`, 1]),
  ),
};

async function mockWide(page: Page) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WIDE_STATUS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WIDE_NODES) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(WIDE_HEALTH) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
}

test.describe('Stage D — per-column scrolling, page never scrolls', () => {
  test('selected + 60 nodes: document does not scroll; rail scrolls to the last node; pane stays put; composer visible', async ({ page, context }) => {
    await login(context);
    await mockWide(page);
    await page.goto(`${BASE}/nodes/stage-d-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-node-list-item]')).toHaveCount(WIDE_N);

    // 1. The DOCUMENT is not the scroller: page height ≈ viewport height.
    // Poll: the HealthBanner mounts on SWR resolve and the page height
    // effect re-measures via ResizeObserver — an eager read can land in
    // that 1-frame window (measured 751 vs 720 flake in combined runs).
    const innerH = await page.evaluate(() => window.innerHeight);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight), { timeout: 5000 })
      .toBeLessThanOrEqual(innerH + 2);

    // Capture the pane's resting position BEFORE any rail scrolling —
    // the invariant is "does not move", not "sits at literal 0": the
    // AppShell HealthBanner keeps ~28px in flow above the page, so the
    // pane's top equals the banner height, and asserting a hardcoded 0
    // would encode the banner out of existence.
    const paneTop0 = await pane(page).evaluate(el => el.getBoundingClientRect().top);
    expect(paneTop0).toBeGreaterThanOrEqual(0);
    expect(paneTop0).toBeLessThanOrEqual(40);

    // 2. The RAIL is a real scroller (positive direction: it genuinely
    //    overflows — otherwise "can scroll" would be vacuous)…
    const railScroll = page.locator('[data-testid="node-list-scroll"]');
    const { railSH, railCH } = await railScroll.evaluate(el => ({ railSH: el.scrollHeight, railCH: el.clientHeight }));
    expect(railSH).toBeGreaterThan(railCH + 200);
    // …and it reaches the LAST node (通信龙 判据: don't swap "page can't
    //    scroll" in for "rail can't scroll either").
    await railScroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator(`[data-node-list-item][data-node-list-alias="stage-d-${WIDE_N}"]`)).toBeInViewport();

    // 3. With the rail scrolled to the bottom, the chat pane has not moved.
    const paneTop = await pane(page).evaluate(el => el.getBoundingClientRect().top);
    expect(paneTop).toBe(paneTop0);

    // 4. Composer stays inside the viewport.
    const box = await pane(page).locator('textarea').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(innerH);
  });

  test('unselected + 60 nodes: document still does not scroll; the MIDDLE column scrolls to the last card', async ({ page, context }) => {
    await login(context);
    await mockWide(page);
    await manageMode(page);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-node-card]')).toHaveCount(WIDE_N, { timeout: 15000 });

    // Poll: the HealthBanner mounts on SWR resolve and the page height
    // effect re-measures via ResizeObserver — an eager read can land in
    // that 1-frame window (measured 751 vs 720 flake in combined runs).
    const innerH = await page.evaluate(() => window.innerHeight);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight), { timeout: 5000 })
      .toBeLessThanOrEqual(innerH + 2);

    // The table view must still reach node 60 via its own scroller —
    // the same both-directions discipline as Stage C. Scroll the CONTAINER
    // explicitly: scrollIntoViewIfNeeded raced the 5s SWR re-render (row
    // nodes get re-created mid-scroll → occasional flake in combined runs).
    const main = page.locator('[data-testid="nodes-main-scroll"]');
    await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator(`[data-node-card][data-node-alias="stage-d-${WIDE_N}"]`)).toBeInViewport();
  });

  test('SPEC §2 colors: list #0F1320, chat #141826, 1px rgba(255,255,255,0.06) between', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    // This is the DARK contract — pin the theme so TEST_THEME=light/slack
    // full-suite runs still verify it (a dark-values test under ambient
    // light would be a false red, not a finding). Wait for ThemeProvider
    // to settle first or the pin gets overwritten a frame later.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'cyber'); document.documentElement.removeAttribute('data-skin'); });

    const railBg = await page.locator('[data-node-list-rail]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(railBg).toBe('rgb(15, 19, 32)'); // #0F1320
    const paneBg = await pane(page).evaluate(el => getComputedStyle(el).backgroundColor);
    expect(paneBg).toBe('rgb(20, 24, 38)'); // #141826
    const railBorder = await page.locator('[data-node-list-rail]').evaluate(el => {
      const cs = getComputedStyle(el);
      return { color: cs.borderRightColor, width: cs.borderRightWidth };
    });
    expect(railBorder.width).toBe('1px');
    expect(railBorder.color).toBe('rgba(255, 255, 255, 0.06)');
    // Exactly ONE line between list and chat: the pane must not add its own left border.
    const paneLeft = await pane(page).evaluate(el => getComputedStyle(el).borderLeftWidth);
    expect(paneLeft).toBe('0px');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Stage D ③ (Vincent's red box) — rail-top node search, persistent in
// the SELECTED state (where the middle table + its magnifier search no
// longer render, so without this the user couldn't search at all).
// Backed by the same search state + pinyinMatch chain as the table.
// ─────────────────────────────────────────────────────────────────────
const PAY_ALIAS = '支付助手';
const SEARCH_STATUS = {
  sessions: [
    { alias: PAY_ALIAS, status: 'idle', network_id: 'net_x' },
    { alias: 'stage-e-1', status: 'idle', network_id: 'net_x' },
    { alias: 'stage-e-2', status: 'working', network_id: 'net_x' },
  ],
};
const SEARCH_NODES = { nodes: SEARCH_STATUS.sessions.map(s => ({ alias: s.alias, team: null, tags: [] })) };
const SEARCH_HEALTH = {
  ok: true, version: '0.9.0-test', sse_connections: 3,
  sse_sessions: Object.fromEntries(SEARCH_STATUS.sessions.map(s => [`net_x:${s.alias}`, 1])),
};

async function mockSearch(page: Page) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_STATUS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_NODES) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_HEALTH) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
}

test.describe('Stage D ③ — rail-top node search', () => {
  const items = (page: Page) => page.locator('[data-node-list-item]');
  const railSearch = (page: Page) => page.locator('[data-testid="rail-search"]');

  test('search box exists in the SELECTED state and filters by pinyin initials ("zf" → 支付助手)', async ({ page, context }) => {
    await login(context);
    await mockSearch(page);
    await page.goto(`${BASE}/nodes/stage-e-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    // The whole point: the table (and its magnifier search) is gone here,
    // but the rail search is present.
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
    await expect(railSearch(page)).toBeVisible();

    await railSearch(page).fill('zf');
    await expect(items(page)).toHaveCount(1, { timeout: 10000 }); // pinyin dict loads lazily
    await expect(page.locator(`[data-node-list-item][data-node-list-alias="${PAY_ALIAS}"]`)).toBeVisible();

    await railSearch(page).fill('');
    await expect(items(page)).toHaveCount(3);
  });

  test('filters by Chinese substring ("支付" → 支付助手)', async ({ page, context }) => {
    await login(context);
    await mockSearch(page);
    await page.goto(`${BASE}/nodes/stage-e-1`);
    await expect(railSearch(page)).toBeVisible({ timeout: 15000 });

    await railSearch(page).fill('支付');
    await expect(items(page)).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator(`[data-node-list-item][data-node-list-alias="${PAY_ALIAS}"]`)).toBeVisible();
  });

  test('no-match search shows count 0 PLUS an empty-state hint echoing the query', async ({ page, context }) => {
    await login(context);
    await mockSearch(page);
    await page.goto(`${BASE}/nodes/stage-e-1`);
    await expect(railSearch(page)).toBeVisible({ timeout: 15000 });

    await railSearch(page).fill('zzz-no-such-node-999');
    await expect(items(page)).toHaveCount(0);
    // 通信龙 判据: "search broke and returned nothing" must be
    // distinguishable from "genuinely no match" — the hint echoes the query.
    await expect(page.locator('[data-testid="rail-search-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="rail-search-empty"]')).toContainText('zzz-no-such-node-999');
  });

  test('unselected state: rail search filters rail AND table together (Stage A invariant holds)', async ({ page, context }) => {
    await login(context);
    await mockSearch(page);
    await manageMode(page);
    await page.goto(`${BASE}/nodes`);
    await expect(page.locator('[data-node-card]')).toHaveCount(3, { timeout: 15000 });

    await railSearch(page).fill('支付');
    await expect(items(page)).toHaveCount(1, { timeout: 10000 });
    await expect(page.locator('[data-node-card]')).toHaveCount(1);
    await expect(page.locator(`[data-node-card][data-node-alias="${PAY_ALIAS}"]`)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Stage D — Vincent's exact scroll spec, BOTH halves pinned:
// "右侧不能上下滑动" = no PAGE-level scroll from the chat column. It
// does NOT mean the message history can't scroll — that would delete
// the feature (and "page doesn't scroll" assertions alone would stay
// green for that regression, 通信龙 判据). So this test loads enough
// messages to overflow and asserts: page fixed + column fixed + the
// MESSAGE AREA scrolls internally + composer never leaves the viewport.
// ─────────────────────────────────────────────────────────────────────
test.describe('Stage D — chat column fixed, message area scrolls inside', () => {
  test('30 messages: page & pane do not move; history scrolls to the earliest message; composer stays visible', async ({ page, context }) => {
    await login(context);
    const tasks = Array.from({ length: 30 }, (_, i) => ({
      task_id: `t-${i + 1}`,
      from_name: 'dashboard',
      to_name: 'stage-e-1',
      status: 'replied',
      priority: 'normal',
      content: `chat msg ${i + 1}`,
      result: `reply ${i + 1}`,
      created_at: `2026-07-31 10:${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${String((i % 2) * 30).padStart(2, '0')}`,
    }));
    await page.route('**/api/hub/status**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_STATUS) }));
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_NODES) }));
    await page.route('**/api/hub/health', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SEARCH_HEALTH) }));
    await page.route('**/api/hub/tasks**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks }) }));
    await page.route('**/api/hub/stats**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
    await page.route('**/api/hub/messages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));

    await page.goto(`${BASE}/nodes/stage-e-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    const ms = page.locator('[data-testid="chat-messages-scroll"]');
    await expect(ms.getByText('chat msg 30').first()).toBeVisible({ timeout: 15000 });

    // Page level: nothing scrolls.
    // Poll: the HealthBanner mounts on SWR resolve and the page height
    // effect re-measures via ResizeObserver — an eager read can land in
    // that 1-frame window (measured 751 vs 720 flake in combined runs).
    const innerH = await page.evaluate(() => window.innerHeight);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight), { timeout: 5000 })
      .toBeLessThanOrEqual(innerH + 2);
    const paneTop0 = await pane(page).evaluate(el => el.getBoundingClientRect().top);

    // Message area level: it DOES scroll (positive half — it genuinely overflows)…
    const { msSH, msCH } = await ms.evaluate(el => ({ msSH: el.scrollHeight, msCH: el.clientHeight }));
    expect(msSH).toBeGreaterThan(msCH + 200);
    // …and scrolling to the top reveals the EARLIEST message…
    await ms.evaluate(el => { el.scrollTop = 0; });
    await expect(ms.getByText('chat msg 1').first()).toBeVisible();
    // …while the column itself has not moved and the composer is still on screen.
    const paneTop1 = await pane(page).evaluate(el => el.getBoundingClientRect().top);
    expect(paneTop1).toBe(paneTop0);
    const box = await pane(page).locator('textarea').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(innerH);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Vincent 插单 (07-31): desktop /nodes opens INTO a conversation.
// Traps pinned: ① replace-not-push (back must LEAVE /nodes, not bounce),
// ② the manage table keeps an explicit doorway, ③ an explicit ✕ is not
// answered by an immediate re-select, plus empty-list safety.
// ─────────────────────────────────────────────────────────────────────
test.describe('auto-select first conversation on /nodes (desktop)', () => {
  test('entering /nodes lands in the first conversation: URL rewritten, table yields', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/nodes\/[^/]+$/);
    await expect(page.locator('[data-node-card]')).toHaveCount(0);
    // deterministic first pick under this fixture's sort
    await expect(pane(page)).toHaveAttribute('data-chat-alias', 'stage-b-1');
  });

  test('browser back LEAVES /nodes (auto-select uses replace, not push)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/tasks`);
    await page.goto(`${BASE}/nodes`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/nodes\/[^/]+$/);

    await page.goBack();
    // With push instead of replace this bounces straight back into
    // /nodes/<alias> — the assertion below goes red (sabotage-verified).
    await expect(page).toHaveURL(`${BASE}/tasks`, { timeout: 10000 });
  });

  test('explicit ✕ close sticks: no immediate re-select', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="chat-pane-close"]').click();
    await expect(pane(page)).toHaveCount(0);
    await expect(page).toHaveURL(`${BASE}/nodes`);
    await expect(page.locator('[data-node-card]')).toHaveCount(3);
    await page.waitForTimeout(900);
    await expect(pane(page)).toHaveCount(0); // still closed — ✕ won
  });

  test('manage-view doorway: toggle to table, persists across reload, toggles back to conversation', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="manage-view-toggle"]').click();
    await expect(pane(page)).toHaveCount(0);
    await expect(page.locator('[data-node-card]')).toHaveCount(3);

    await page.goto(`${BASE}/nodes`); // persisted preference: table default, no auto-select
    await expect(page.locator('[data-node-card]')).toHaveCount(3, { timeout: 15000 });
    await page.waitForTimeout(900);
    await expect(pane(page)).toHaveCount(0);

    await page.locator('[data-testid="manage-view-toggle"]').click(); // 对话视图
    await expect(pane(page)).toBeVisible();
    await expect(page).toHaveURL(/\/nodes\/[^/]+$/);
  });

  test('empty list: no crash, no loop, URL stays /nodes', async ({ page, context }) => {
    await login(context);
    await page.route('**/api/hub/status**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) }));
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [] }) }));
    await page.route('**/api/hub/health', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sse_sessions: {} }) }));
    await page.route('**/api/hub/tasks**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
    await page.route('**/api/hub/stats**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
    await page.route('**/api/hub/messages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
    await page.goto(`${BASE}/nodes`);
    await page.waitForTimeout(2500);
    await expect(page).toHaveURL(`${BASE}/nodes`);
    await expect(pane(page)).toHaveCount(0);
    await expect(page.locator("text=This page couldn’t load")).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// SPEC §2 light mode — the columns must follow the theme (in prod v52
// they didn't: light body + dark rail + dark chat, 通信龙's production
// measurement). Mechanism under test: [data-theme] shims in globals.css
// (repo's established compat pattern — flips locked files like ChatPane
// without editing them). Round-trip pinned: switching AWAY from dark and
// BACK must restore the exact dark values (a one-way switch is the bug
// class 通信龙 warned about).
// ─────────────────────────────────────────────────────────────────────
test.describe('SPEC §2 light mode columns', () => {
  const colDark = { rail: 'rgb(15, 19, 32)', pane: 'rgb(20, 24, 38)', line: 'rgba(255, 255, 255, 0.06)' };
  const colLight = { rail: 'rgb(250, 250, 252)', pane: 'rgb(255, 255, 255)', line: 'rgba(0, 0, 0, 0.06)' };

  // toHaveCSS auto-retries and re-queries — a raw evaluate raced SWR
  // re-renders (rail momentarily detached → null deref flake in combined
  // runs). Denominator style: toHaveCSS itself fails loudly if the
  // element never matches, so "0 matched" can't silently pass.
  async function expectCols(page: Page, want: { rail: string; pane: string; line: string }) {
    const rail = page.locator('[data-node-list-rail]');
    const chat = page.locator('[data-testid="chat-pane"]');
    await expect(rail).toHaveCSS('background-color', want.rail);
    await expect(chat).toHaveCSS('background-color', want.pane);
    await expect(rail).toHaveCSS('border-right-color', want.line);
  }
  const setTheme = (page: Page, t: string) => page.evaluate(th => {
    const el = document.documentElement;
    if (th === 'slack') { el.setAttribute('data-theme', 'light'); el.setAttribute('data-skin', 'slack'); }
    else { el.setAttribute('data-theme', th as string); el.removeAttribute('data-skin'); }
  }, t);

  test('light columns = SPEC values; dark→light→dark round-trip restores EXACT dark values', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    // Wait for ThemeProvider's mount effect to have applied the ambient
    // theme first — pinning before it runs gets overwritten a frame later
    // (flaked only under TEST_THEME=light). Then own the starting theme.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);
    await setTheme(page, 'cyber');

    await expectCols(page, colDark);        // cyber (pinned above)
    await setTheme(page, 'light');
    await expectCols(page, colLight);       // SPEC §2 light
    await setTheme(page, 'cyber');
    await expectCols(page, colDark);        // round-trip exact
  });

  test('slack skin (light + data-skin) keeps the light column values', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    // same ThemeProvider-settle guard as the other theme-contract tests —
    // pinning before its mount effect runs gets overwritten a frame later
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);
    await setTheme(page, 'slack');
    await expectCols(page, colLight);
  });

  test('WCAG numbers, BOTH themes: badge ≥ 4.5 enforced; presence dot measured (report-only, issue #70)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    // Wait for ThemeProvider's mount effect to have applied the ambient
    // theme first — pinning before it runs gets overwritten a frame later
    // (flaked only under TEST_THEME=light). Then own the starting theme.
    await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') !== null);
    await setTheme(page, 'cyber');

    // 通信龙 判据: measure the dot in DARK first — if it were already
    // borderline there, tuning only light would paper over it.
    const darkDot = await page.evaluate(() => {
      // Tailwind v4 emits palette colors as lab()/oklch() — regex-parsing
      // computed values as if rgb produced garbage ratios (caught when the
      // dark dot measured 1.86 while visually obviously high-contrast).
      // Canvas rasterization resolves ANY css color to true sRGB bytes.
      const toRgb = (c: string): [number, number, number] => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const ctx2 = cv.getContext('2d')!;
        ctx2.fillStyle = c; ctx2.fillRect(0, 0, 1, 1);
        const d = ctx2.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const lum = (c: string) => {
        const [r, g, b] = toRgb(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      probe.className = 'bg-green-400 ring-[var(--col-list)]';
      const dot = getComputedStyle(probe).backgroundColor;
      probe.className = 'bg-[var(--col-list)]';
      const rail = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const [l1, l2] = [lum(dot), lum(rail)].sort((x, y) => y - x);
      return { ratio: (l1 + 0.05) / (l2 + 0.05), dotRgb: toRgb(dot).join(','), railRgb: toRgb(rail).join(','), theme: document.documentElement.getAttribute('data-theme') };
    });
    console.log('WCAG dark dot:', JSON.stringify(darkDot));
    // status-dot thresholds are issue #70's separate section (global status
    // colors, NOT this batch) — numbers are REPORTED here, not enforced.
    expect(darkDot.theme).toBe('cyber');
    expect(darkDot.dotRgb).toMatch(/^\d+,\d+,\d+$/); // real pixels measured

    await setTheme(page, 'light');

    const ratios = await page.evaluate(() => {
      const toRgb = (c: string): [number, number, number] => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const ctx2 = cv.getContext('2d')!;
        ctx2.fillStyle = c; ctx2.fillRect(0, 0, 1, 1);
        const d = ctx2.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const lum = (c: string) => {
        const [r, g, b] = toRgb(c).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a: string, b: string) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
      // computed values straight from the live stylesheet (no hardcoding)
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      const style = (cls: string, prop: 'backgroundColor' | 'color') => {
        probe.className = cls;
        return getComputedStyle(probe)[prop];
      };
      // Measure the TOKEN classes the UI actually uses now (the old hex
      // classes only exist in the build because THIS test file mentions
      // them — Tailwind scans tests/ too; measuring them would probe a
      // ghost. Canvas resolves lab()/oklch to true sRGB.)
      const badgeBg = style('bg-[var(--badge-muted-bg)]', 'backgroundColor');
      const badgeFg = style('text-[var(--badge-muted-fg)]', 'color');
      const dotBg = style('bg-green-400', 'backgroundColor');
      const railBg = style('bg-[var(--col-list)]', 'backgroundColor');
      probe.remove();
      return {
        badge: ratio(badgeFg, badgeBg),
        dot: ratio(dotBg, railBg),
        values: { badgeBg: toRgb(badgeBg).join(','), badgeFg: toRgb(badgeFg).join(','), dotBg: toRgb(dotBg).join(','), railBg: toRgb(railBg).join(',') },
        theme: document.documentElement.getAttribute('data-theme'),
        denominators: {
          rail: document.querySelectorAll('[data-node-list-rail]').length,
          pane: document.querySelectorAll('[data-testid="chat-pane"]').length,
        },
      };
    });
    console.log('WCAG light-mode ratios:', JSON.stringify(ratios));
    // 分母+状态前置断言 (通信龙: 匹配 0 个/主题没切到时,后面的数字断言
    // 会变恒真或恒假 — 先钉住"量的确实是 light 下的真元素"):
    expect(ratios.theme).toBe('light');
    expect(ratios.denominators.rail).toBeGreaterThan(0);
    expect(ratios.denominators.pane).toBeGreaterThan(0);
    // 若这三个值仍是深色对 (#475569 底), 说明主题没生效 — 直接红在这里
    expect(ratios.values.badgeBg).not.toBe('71,85,105'); // dark pair would mean theme didn't apply
    expect(ratios.badge).toBeGreaterThanOrEqual(4.5); // text contrast (badge IS this batch)
    expect(ratios.dot).toBeGreaterThan(0);            // dot: report-only (issue #70 status-color section)
  });
});

// ─────────────────────────────────────────────────────────────────────
// Avatar wiring (avatar 接线单) — the half-bridge closed:
//   read: hub nodes.avatar_url is layer 1, ABOVE localStorage (通信龙
//         ruling: hub is the cross-device truth, localStorage is a cache;
//         the old order was WHY avatars looked "stuck" across devices)
//   write: settings panel PUTs /api/hub/nodes/:ref/avatar first, echoes
//         to localStorage only on success.
// ─────────────────────────────────────────────────────────────────────
test.describe('avatar wiring — hub layer', () => {
  // data URI: loads instantly with zero network — the earlier https mock
  // URL intermittently failed to fetch under full-suite load, AliasAvatar's
  // onError swapped to the pill and the img vanished (load-flake, slack
  // runs). No route mock needed, fully deterministic.
  const HUB_AV = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const NODES_WITH_AVATAR = {
    nodes: [
      { alias: 'stage-b-1', team: null, tags: [], avatar_url: HUB_AV },
      { alias: 'stage-b-2', team: null, tags: [] },
      { alias: CN_ALIAS, team: null, tags: [] },
    ],
  };

  test('hub avatar_url renders AND outranks a localStorage override; no-hub nodes keep the pool fallback', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES_WITH_AVATAR) }));

    // adversarial localStorage override for the SAME alias — hub must win
    await page.addInitScript(() =>
      window.localStorage.setItem('anet_avatars_v1', JSON.stringify({ 'stage-b-1': '/avatars/avatar-05.webp' })));
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    // settle first: rail images rendered at all (hub hydration is an
    // effect + AVATAR_EVENT re-render; under parallel-suite load it can
    // lag — seen only in full-suite slack runs, isolated ×3 green)
    await expect(page.locator('[data-node-list-item] img').first()).toBeVisible({ timeout: 15000 });
    const b1 = page.locator('[data-node-list-item][data-node-list-alias="stage-b-1"] img');
    await expect(b1).toHaveAttribute('src', HUB_AV, { timeout: 20000 });
    // fallback intact for a node the hub has no avatar for
    const b2src = await page.locator('[data-node-list-item][data-node-list-alias="stage-b-2"] img').getAttribute('src');
    expect(b2src).toMatch(/^\/avatars\/avatar-\d+\.webp$/);
  });

  test('settings save PUTs the hub proxy first and reports success', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    // disclosure layer: saving requires a nodes row — give the fixture one
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [
        { alias: 'stage-b-1', node_id: 'node-b1', team: null, tags: [] },
        { alias: 'stage-b-2', node_id: 'node-b2', team: null, tags: [] },
      ] }) }));
    const putBodies: unknown[] = [];
    await page.route('**/api/hub/nodes/*/avatar', async r => {
      putBodies.push(r.request().postDataJSON());
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, alias: 'stage-b-1', avatar_url: 'https://cdn.example.com/newpic.png' }) });
    });
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="chat-pane-more"]').click();
    await page.locator('[data-testid="chat-pane-settings"]').click();
    const urlInput = page.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
    await urlInput.fill('https://cdn.example.com/newpic.png');
    await page.locator('[data-testid="avatar-save"]').click();
    await expect(page.locator('[data-testid="avatar-save-ok"]')).toBeVisible();
    expect(putBodies).toEqual([{ avatar_url: 'https://cdn.example.com/newpic.png' }]);
  });

  test('hub rejection surfaces as an error, no silent local echo', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    // disclosure layer: saving requires a nodes row — give the fixture one
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [
        { alias: 'stage-b-1', node_id: 'node-b1', team: null, tags: [] },
        { alias: 'stage-b-2', node_id: 'node-b2', team: null, tags: [] },
      ] }) }));
    await page.route('**/api/hub/nodes/*/avatar', r =>
      r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'invalid_avatar_url', message: '头像 URL 不合法：test-reason' }) }));
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="chat-pane-more"]').click();
    await page.locator('[data-testid="chat-pane-settings"]').click();
    const urlInput = page.locator('input[type="url"]').first();
    await urlInput.fill('https://bad.example.com/x.png');
    await page.locator('[data-testid="avatar-save"]').click();
    await expect(page.locator('[data-testid="avatar-save-error"]')).toContainText('不合法');
    // rejected write must NOT have been echoed into localStorage
    const stored = await page.evaluate(() => window.localStorage.getItem('anet_avatars_v1'));
    expect(stored ?? '{}').not.toContain('bad.example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Avatar disclosure (通信龙 判据): tell the user BEFORE they act. 40 of
// 199 production sessions have no nodes row — hub avatars cannot attach,
// so the editor must say so up front instead of failing on save.
// Both directions from one fixture: stage-b-1 HAS a nodes row (controls
// live), CN_ALIAS has NONE (note shown, controls disabled).
// ─────────────────────────────────────────────────────────────────────
test.describe('avatar disclosure — session-only agents', () => {
  const NODES_PARTIAL = {
    nodes: [
      { alias: 'stage-b-1', node_id: 'node-b1', team: null, tags: [] },
      { alias: 'stage-b-2', node_id: 'node-b2', team: null, tags: [] },
      // CN_ALIAS deliberately ABSENT — session-only agent
    ],
  };

  test('no nodes row → note visible, input and save disabled (before any click)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES_PARTIAL) }));
    await page.goto(`${BASE}/nodes/${encodeURIComponent(CN_ALIAS)}`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="chat-pane-more"]').click();
    await page.locator('[data-testid="chat-pane-settings"]').click();

    await expect(page.locator('[data-testid="avatar-no-node-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="avatar-no-node-note"]')).toContainText('未注册为节点');
    await expect(page.locator('[data-testid="avatar-url-input"]')).toBeDisabled();
    await expect(page.locator('[data-testid="avatar-save"]')).toBeDisabled();
  });

  test('HAS nodes row → no note, input enabled (positive control, same fixture)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES_PARTIAL) }));
    await page.goto(`${BASE}/nodes/stage-b-1`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="chat-pane-more"]').click();
    await page.locator('[data-testid="chat-pane-settings"]').click();

    await expect(page.locator('[data-testid="avatar-url-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="avatar-no-node-note"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="avatar-url-input"]')).toBeEnabled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Avatar clear-consistency (#72 reviewer gap, 通信龙-approved follow-up):
// for a NODE-BACKED alias the hub is the whole truth — including "cleared"
// (avatar_url null). A stale localStorage override on another device must
// NOT resurrect the old picture. Session-only aliases (no nodes row) keep
// localStorage as their only personalization — pinned as the control.
// ─────────────────────────────────────────────────────────────────────
test.describe('avatar clear-consistency — hub authority for node-backed aliases', () => {
  const NODES_CLEARED = {
    nodes: [
      { alias: 'stage-b-1', node_id: 'node-b1', team: null, tags: [], avatar_url: null }, // node-backed, CLEARED
      { alias: 'stage-b-2', node_id: 'node-b2', team: null, tags: [] },
      // CN_ALIAS absent → session-only
    ],
  };

  test('hub-cleared node-backed alias: stale localStorage override is MASKED, designed default shows', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES_CLEARED) }));
    // the "other device's" stale override
    await page.addInitScript(() =>
      window.localStorage.setItem('anet_avatars_v1', JSON.stringify({ 'stage-b-1': '/avatars/avatar-05.webp' })));
    await page.goto(`${BASE}/nodes/stage-b-2`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    // Polling assertion — hub hydration is an effect + event re-render;
    // a single-shot getAttribute raced it under full-suite load (the
    // pre-hydration frame still shows the stale override).
    const b1img = page.locator('[data-node-list-item][data-node-list-alias="stage-b-1"] img');
    await expect(b1img).toHaveAttribute('src', /^\/avatars\/avatar-(?!05\b)\d+\.webp$/, { timeout: 15000 }); // pool default AND not the stale 05 override
  });

  test('session-only alias: localStorage override still works (control — localStorage is not dead)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES_CLEARED) }));
    await page.addInitScript((cn) =>
      window.localStorage.setItem('anet_avatars_v1', JSON.stringify({ [cn as string]: '/avatars/avatar-11.webp' })), CN_ALIAS);
    await page.goto(`${BASE}/nodes/stage-b-2`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    await expect(page.locator(`[data-node-list-item][data-node-list-alias="${CN_ALIAS}"] img`))
      .toHaveAttribute('src', '/avatars/avatar-11.webp', { timeout: 15000 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Avatar load-failure fallback (historical test gap flagged in the
// batch-2 independent review): "img fails → pill" was NEVER covered —
// the old https mock always fulfilled 200, and the data:-URI fixture
// can't fail. Avatars are on three surfaces now and real URLs really
// do break. route.abort() forces onError deterministically.
// Both directions from one fixture: broken URL → pill (initial visible,
// no <img>); working data URI → real <img> (control).
// ─────────────────────────────────────────────────────────────────────
test.describe('avatar fallback — broken image degrades to the pill', () => {
  const OK_AV = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const BROKEN_AV = 'https://broken.example.com/gone.png';

  test('broken avatar_url → pill fallback; working one → img (same fixture)', async ({ page, context }) => {
    await login(context);
    await mockCommon(page);
    await page.route('**/api/hub/nodes**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [
        { alias: 'stage-b-1', node_id: 'node-b1', team: null, tags: [], avatar_url: BROKEN_AV },
        { alias: 'stage-b-2', node_id: 'node-b2', team: null, tags: [], avatar_url: OK_AV },
        { alias: CN_ALIAS, team: null, tags: [] },
      ] }) }));
    await page.route(BROKEN_AV, r => r.abort()); // deterministic onError

    await page.goto(`${BASE}/nodes/${encodeURIComponent(CN_ALIAS)}`);
    await expect(pane(page)).toBeVisible({ timeout: 15000 });

    // control first (denominator: hub hydration landed, imgs render at all)
    await expect(page.locator('[data-node-list-item][data-node-list-alias="stage-b-2"] img'))
      .toHaveAttribute('src', OK_AV, { timeout: 15000 });

    // broken → the img must be GONE and the pill must be VISIBLE with an
    // initial (not a blank box — DOM presence ≠ 用户看得见).
    const b1 = page.locator('[data-node-list-item][data-node-list-alias="stage-b-1"]');
    await expect(b1.locator('img')).toHaveCount(0, { timeout: 15000 });
    const pill = b1.locator('.anet-alias-avatar');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/\S/); // real glyph rendered
  });
});
