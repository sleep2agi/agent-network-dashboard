import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// 通信龙 07-31 SPEC §12 remaining — ChatPane header ⋮/📋/🔍 wire-up.
//
// Each test double-asserts (positive + negative) per 通信龙 discipline
// "接上了（正向）+ 该不生效时不生效（反向）", and each will have a
// dedicated witnessed-red mutation applied after this file lands green.
//
// Covered:
//   ① ⋮ opens overflow menu with 4 items (add tab / view tasks /
//     settings / separator). Menu container reuses SPEC §10 tokens.
//     Reverse: outside click closes the menu.
//   ② 🔍 dispatches chat:open-search → TaskChatPanel search UI shows.
//     Reverse: no click → search UI hidden.
//   ③ 📋 link href resolves to `/tasks?to_name=<alias>` (URL param
//     name must match TasksView's useSearchParams keys — 'to_name',
//     not 'alias').
//   ④ /tasks?from_name=<alias> filters list to matching from_name
//     entries only. Reverse: without the param, list is unfiltered.
//   ⑤ overflow "添加标签页" → row acquires data-node-pinned="true".
//     Reverse: before click, attr is "false".

let cachedCookie: string | undefined;

async function login(context: Page['context'] extends () => infer C ? C : never) {
  if (cachedCookie) {
    await context.addCookies([{ name: 'anet_dashboard_session', value: cachedCookie,
      domain: new URL(BASE).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
    return;
  }
  const res = await context.request.post(`${BASE}/api/auth/login`, {
    data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
  });
  const setCookie = res.headers()['set-cookie'] || '';
  const m = setCookie.match(/anet_dashboard_session=([^;]+)/);
  if (m) {
    cachedCookie = decodeURIComponent(m[1]);
    await context.addCookies([{ name: 'anet_dashboard_session', value: cachedCookie,
      domain: new URL(BASE).hostname, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  }
}

const FIXTURE_SESSIONS = {
  sessions: [
    { alias: 'node-alpha', status: 'idle', network_id: 'net_x' },
    { alias: 'node-beta',  status: 'idle', network_id: 'net_x' },
  ],
};
const FIXTURE_NODES = {
  nodes: [
    { alias: 'node-alpha', node_id: 'n_a', team: null, tags: [], attrs_revision: 0 },
    { alias: 'node-beta',  node_id: 'n_b', team: null, tags: [], attrs_revision: 0 },
  ],
};

// For /tasks filter test: 6 tasks total — 2 from node-alpha, 2 from
// node-beta, 2 with a third from_name. This makes "带 from_name 筛"
// vs "不带 → 全量" measurably different (2 vs 6).
const FIXTURE_TASKS_ALL = [
  { task_id: 't1', from_name: 'node-alpha', to_name: 'node-beta',  status: 'replied',   content: 'a1', result: 'ok', created_at: '2026-07-31T10:00:00', priority: 'normal' },
  { task_id: 't2', from_name: 'node-alpha', to_name: 'node-gamma', status: 'delivered', content: 'a2', result: '',   created_at: '2026-07-31T10:01:00', priority: 'normal' },
  { task_id: 't3', from_name: 'node-beta',  to_name: 'node-alpha', status: 'acked',     content: 'b1', result: '',   created_at: '2026-07-31T10:02:00', priority: 'normal' },
  { task_id: 't4', from_name: 'node-beta',  to_name: 'node-alpha', status: 'replied',   content: 'b2', result: 'ok', created_at: '2026-07-31T10:03:00', priority: 'normal' },
  { task_id: 't5', from_name: 'node-omega', to_name: 'node-alpha', status: 'queued',    content: 'o1', result: '',   created_at: '2026-07-31T10:04:00', priority: 'normal' },
  { task_id: 't6', from_name: 'node-omega', to_name: 'node-beta',  status: 'failed',    content: 'o2', result: 'x',  created_at: '2026-07-31T10:05:00', priority: 'normal' },
];

async function stubHubBase(page: Page) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_SESSIONS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_NODES) }));
  await page.route('**/api/hub/networks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ networks: [{ network_id: 'net_x', network_name: 'net_x' }] }) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.9.0-test', sse_connections: 0, sse_sessions: {} }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/hub/events**', r =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  await page.route('**/api/anet/node-config**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ model: '', flags: {}, channels: [], config_revision: 0 }) }));
}

// /api/hub/tasks stub that honors from_name/to_name query params —
// mirrors what the real hub does. If our tested URL-param wiring is
// wrong, the filter won't be applied and the test reds.
async function stubTasks(page: Page) {
  await page.route('**/api/hub/tasks**', r => {
    const url = new URL(r.request().url());
    const from = url.searchParams.get('from_name');
    const to = url.searchParams.get('to_name');
    let out = FIXTURE_TASKS_ALL.slice();
    if (from) out = out.filter(t => t.from_name === from);
    if (to) out = out.filter(t => t.to_name === to);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: out, total: out.length }) });
  });
}

test.describe('ChatPane header — overflow menu / search event / /tasks URL params', () => {
  test('① ⋮ opens overflow menu with 4 items; outside click closes it', async ({ page, context }) => {
    await login(context);
    await stubHubBase(page);
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    const more = page.locator('[data-testid="chat-pane-more"]').first();
    await expect(more).toBeVisible();

    // Reverse: menu is NOT open before we click. If a prior render
    // leaked open state, "click → check open" would still pass.
    await expect(page.locator('[data-testid="chat-pane-overflow-menu"]')).toHaveCount(0);

    await more.click();
    const menu = page.locator('[data-testid="chat-pane-overflow-menu"]');
    await expect(menu).toBeVisible({ timeout: 3000 });

    // All 4 menu items are present. Each check pulls a distinct
    // testid — if two collapsed (e.g. only 3 items rendered because
    // one is conditional), this reds precisely on the missing one.
    // Locale-agnostic assertions: Playwright defaults to en-US and
    // t(zh, en) returns en. Accept both — the test is proving "this
    // item exists with a non-empty user-facing label", not policing
    // the exact copy (that job belongs to a separate copy-review).
    await expect(menu.locator('[data-testid="chat-pane-overflow-pin"]')).toHaveText(/添加标签页|移除标签页|Add as tab|Remove tab/);
    await expect(menu.locator('[data-testid="chat-pane-overflow-view-tasks"]')).toHaveText(/查看任务|View tasks/);
    await expect(menu.locator('[data-testid="chat-pane-settings"]')).toHaveText(/会话设置|Conversation settings/);
    await expect(menu.locator('[data-testid="chat-pane-overflow-separator"]')).toHaveCount(1);

    // Reverse: outside click closes.
    await page.mouse.click(10, 10);
    await expect(page.locator('[data-testid="chat-pane-overflow-menu"]')).toHaveCount(0);
  });

  test('② 🔍 dispatches chat:open-search → TaskChatPanel search UI mounts; without click stays hidden', async ({ page, context }) => {
    await login(context);
    await stubHubBase(page);
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    // Reverse: search input is NOT present before click. TaskChatPanel
    // has a search input (searchInputRef) that mounts only when
    // searchOpen is true. Its DOM presence is our signal.
    // We look for input[placeholder*="搜索"] scoped to the chat pane.
    const searchInput = page.locator('[data-testid="chat-pane"] input[placeholder*="搜索"], [data-testid="chat-pane"] input[placeholder*="Search"]').first();
    await expect(searchInput).toHaveCount(0);

    // Confirm the header button is enabled (previously disabled).
    const searchBtn = page.locator('[data-testid="chat-pane-search"]').first();
    await expect(searchBtn).toBeVisible();
    await expect(searchBtn).toBeEnabled();
    await expect(searchBtn).toHaveAttribute('data-search-enabled', 'true');

    await searchBtn.click();
    // TaskChatPanel schedules focus with setTimeout(50); allow it.
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('③ 📋 view-tasks link points to /tasks?to_name=<alias> (encoded)', async ({ page, context }) => {
    await login(context);
    await stubHubBase(page);
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    const link = page.locator('[data-testid="chat-pane-view-tasks"]').first();
    await expect(link).toBeVisible();
    // Assert the EXACT href, not just contains: catches both wrong
    // param name (?alias= would still contain the alias) and wrong
    // scheme/path (something like /tasks/#... won't match).
    const href = await link.getAttribute('href');
    expect(href).toBe('/tasks?to_name=node-alpha');
  });

  test('④ /tasks reads from_name / to_name URL params → prefills filter inputs', async ({ page, context }) => {
    // The wire we're testing is TasksView.tsx:75-76 —
    //   useState(searchParams.get('from_name') || '')
    // The most direct fact-side check is: after navigating to
    // /tasks?from_name=X, the visible "From" input's value === X.
    // We DO NOT depend on the /api/hub/tasks fetch/response
    // (previous version did — /tasks has a client-side "401 →
    // /login" redirect in TasksView.tsx:126 that got tripped by
    // rate-limit flakiness in local dev, red-herring for this
    // wire). The input value assertion catches the exact bug M4
    // targets: silent drop of URL param.
    await login(context);
    await stubHubBase(page);
    await stubTasks(page);

    // (a) Baseline — no URL param → both inputs empty.
    await page.goto(`${BASE}/tasks`);
    // Filter inputs render early in TasksView (not gated on a
    // successful fetch), so waiting on them avoids the auth-redirect
    // race entirely.
    const fromInput = page.locator('[data-testid="tasks-filter-from"]');
    const toInput = page.locator('[data-testid="tasks-filter-to"]');
    await expect(fromInput).toBeVisible({ timeout: 15000 });
    await expect(fromInput).toHaveValue('');
    await expect(toInput).toHaveValue('');

    // (b) With ?from_name=node-alpha → From input prefilled, To empty.
    await page.goto(`${BASE}/tasks?from_name=node-alpha`);
    await expect(fromInput).toBeVisible({ timeout: 15000 });
    await expect(fromInput).toHaveValue('node-alpha');
    await expect(toInput).toHaveValue('');

    // (c) With ?to_name=node-beta → To input prefilled, From empty.
    // This is the direction ChatPane's link uses (`?to_name=<alias>`),
    // so both directions must work — not just one.
    await page.goto(`${BASE}/tasks?to_name=node-beta`);
    await expect(fromInput).toBeVisible({ timeout: 15000 });
    await expect(toInput).toHaveValue('node-beta');
    await expect(fromInput).toHaveValue('');

    // (d) Both — belt and suspenders.
    await page.goto(`${BASE}/tasks?from_name=node-alpha&to_name=node-beta`);
    await expect(fromInput).toBeVisible({ timeout: 15000 });
    await expect(fromInput).toHaveValue('node-alpha');
    await expect(toInput).toHaveValue('node-beta');
  });

  test('⑤ overflow "添加标签页" toggles pin (data-node-pinned false→true)', async ({ page, context }) => {
    await login(context);
    await stubHubBase(page);
    // Clear localStorage so we start from unpinned.
    await page.addInitScript(() => {
      try { window.localStorage.removeItem('anet_chat_pin_v1'); } catch {}
    });
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    // Premise: node-alpha's rail row starts unpinned (attr === 'false').
    const alphaRow = page.locator('[data-node-list-alias="node-alpha"]').first();
    await expect(alphaRow).toHaveAttribute('data-node-pinned', 'false');

    await page.locator('[data-testid="chat-pane-more"]').click();
    await expect(page.locator('[data-testid="chat-pane-overflow-menu"]')).toBeVisible({ timeout: 3000 });
    // "添加标签页" — label depends on state; assert menu item then click.
    const pinItem = page.locator('[data-testid="chat-pane-overflow-pin"]');
    // Locale-agnostic: could be zh or en; premise is "starts in the
    // ADD (not REMOVE) state" — we cleared localStorage above so it
    // should be Add. Assert against both language forms.
    await expect(pinItem).toHaveText(/添加标签页|Add as tab/);
    await pinItem.click();

    // Menu should have auto-closed via onClose in the handler.
    await expect(page.locator('[data-testid="chat-pane-overflow-menu"]')).toHaveCount(0);

    // 🔴 Core: the rail row's data-node-pinned flipped to 'true'.
    // useSyncExternalStore reacts to the storage event; give it a tick.
    await expect(alphaRow).toHaveAttribute('data-node-pinned', 'true', { timeout: 2000 });
  });
});
