import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// 07-31 batch (通信龙): 3 hard tests for the NodeList/ChatPane batch.
// Each test asserts an interaction that has no error surface if broken
// (would ship as "点了没反应" / "打了草稿没了" / "菜单少两项"):
//
//   ① settings drawer open/close does NOT unmount TaskChatPanel
//      (draft-in-input survives). Witnessed-red by mutating the drawer
//      to KEY-remount the chat (parent-controlled key change → React
//      remount → draft lost).
//   ② keyboard focus discipline: ↓ moves URL when focus is on the
//      rail, ↓ does NOT move URL when focus is in a text input.
//   ③ right-click near list bottom → context menu flips upward
//      (menu.getBoundingClientRect().bottom <= viewport.bottom).
//
// Not covered here (already visible in vf.mjs on prod real-data run):
// - pin/mute badge color swap (unit-level; SPEC §11.3 tokens hardcoded)
// - view-tasks / search buttons render (trivially visible)

// Per-worker login cache — dashboard rate-limit is 10 logins / 15min / IP.
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
const FIXTURE_HEALTH = {
  ok: true, version: '0.9.0-test', sse_connections: 3,
  sse_sessions: {
    'net_x:node-alpha': 1, 'net_x:node-beta': 1, 'net_x:node-gamma': 1,
  },
};

async function stubHub(page: Page) {
  // TEST_THEME=light|slack runs the whole suite under that theme — behavior
  // must hold in every theme, not just the default cyber (三主题各跑全量).
  if (process.env.TEST_THEME) {
    await page.addInitScript(t => window.localStorage.setItem('anet-theme', t as string), process.env.TEST_THEME);
  }
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_SESSIONS) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_NODES) }));
  await page.route('**/api/hub/networks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ networks: [{ network_id: 'net_x', network_name: 'net_x' }] }) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE_HEALTH) }));
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [] }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/hub/events**', r =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  // NodeSettingsPanel loads a per-node config snapshot — return an
  // empty stub so the drawer mounts without console noise.
  await page.route('**/api/anet/node-config**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: '', flags: {}, channels: [], config_revision: 0 }) }));
}

test.describe('Batch — list actions (07-31)', () => {
  test('① settings drawer open/close does NOT unmount TaskChatPanel (draft survives)', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    // Find the chat's text input. TaskChatPanel renders one primary
    // <textarea> / <input> for message composition — grab the first
    // textbox inside the chat pane.
    const chatInput = page.locator('[data-testid="chat-pane"] textarea, [data-testid="chat-pane"] input[type="text"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    // Type a distinctive draft that would be hard to reproduce by accident.
    const DRAFT = 'preserve-across-settings-toggle-abc123';
    await chatInput.fill(DRAFT);
    await expect(chatInput).toHaveValue(DRAFT);

    // Open settings drawer → close → text MUST still be there.
    // 07-31 SPEC §12 batch: ⋮ now opens overflow menu (not settings
    // direct). "会话设置" is one of four menu items and still carries
    // data-testid="chat-pane-settings" so this assertion's target is
    // preserved — but the click flow is now two steps.
    await page.locator('[data-testid="chat-pane-more"]').click();
    await expect(page.locator('[data-testid="chat-pane-overflow-menu"]')).toBeVisible({ timeout: 3000 });
    await page.locator('[data-testid="chat-pane-settings"]').click();
    await expect(page.locator('[role="dialog"][aria-label*="节点设置"]').first()).toBeVisible({ timeout: 5000 });
    // Close via the backdrop (absolute-positioned inside chat pane).
    await page.keyboard.press('Escape');
    // Wait a tick for React to reconcile.
    await page.waitForTimeout(200);

    // 🔴 The core assertion — the input still holds the same text.
    // If TaskChatPanel got unmounted+remounted, state resets and this
    // reads as empty (or reset to any autosaved draft, which is
    // different — the point is "same value, no interruption").
    await expect(chatInput).toHaveValue(DRAFT);
  });

  test('② kbd focus discipline — ↓ moves URL from rail focus, does NOT from input focus', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    // Wait for rail to actually have entries — the kbd handler
    // bails on sessions.length === 0, so pressing arrow before SWR
    // populates would test nothing.
    await expect(page.locator('[data-node-list-item]').first()).toBeVisible({ timeout: 10000 });
    const railCount = await page.locator('[data-node-list-item]').count();
    expect(railCount).toBeGreaterThanOrEqual(3);

    // Capture browser console to diagnose whether the handler fires.
    const consoleMsgs: string[] = [];
    page.on('console', msg => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));

    // Phase 1 — focus a NON-editable element (a rail entry button).
    // TaskChatPanel refocuses its textarea via setTimeout(300) on
    // mount (TaskChatPanel.tsx:745), so we MUST wait past that
    // window before setting our own focus — otherwise the textarea
    // steals it back mid-test. Wait 500ms > 300ms delay, then focus
    // the button and press the key with no interceding await so no
    // subsequent focus event can preempt.
    await page.waitForTimeout(500);
    await page.locator('[data-node-list-item]').first().focus();
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).toBe('BUTTON');

    const beforeUrl = new URL(page.url()).pathname;
    expect(beforeUrl).toContain('/nodes/');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(500);
    const afterUrl = new URL(page.url()).pathname;
    expect(afterUrl).not.toBe(beforeUrl);
    expect(afterUrl).toContain('node-beta');

    // Phase 2 — dispatch same ArrowDown but with document.activeElement
    // pointing at a text control. My handler bails when active.tagName
    // is INPUT/TEXTAREA. Verify URL does NOT change.
    const chatInput = page.locator('[data-testid="chat-pane"] textarea, [data-testid="chat-pane"] input[type="text"]').first();
    await chatInput.focus();
    await page.waitForTimeout(100);
    const inputUrl = new URL(page.url()).pathname;
    // Sanity: confirm the input actually took focus BEFORE dispatching,
    // otherwise this test would spuriously pass (URL wouldn't change
    // because the handler THINKS active is body → moves URL, but I'd
    // observe unchanged URL for a different reason).
    const activeInInput = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'TEXTAREA']).toContain(activeInInput ?? 'NONE');
    await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
    });
    await page.waitForTimeout(400);
    const stillInputUrl = new URL(page.url()).pathname;
    expect(stillInputUrl).toBe(inputUrl);
  });

  test('③ right-click near list bottom → menu flips upward + stays in viewport', async ({ page, context }) => {
    await login(context);
    await stubHub(page);
    // Small viewport height so any entry the user right-clicks is
    // "near the bottom" — a 120px menu rendered downward would
    // overflow. This is the exact scenario the flip logic protects.
    await page.setViewportSize({ width: 1280, height: 300 });
    // Go to a node page (not /nodes) — the rail renders in both, but
    // going through /nodes/<alias> exercises the exact code path
    // tests 1 & 2 already validated the auth on. Then click the rail
    // entry to force the "list-only" shape (chatAlias unchanged in
    // URL is fine — the point is right-click on the last rail row).
    await page.goto(`${BASE}/nodes/node-alpha`);
    await expect(page.locator('[data-node-list-alias="node-gamma"]').first()).toBeVisible({ timeout: 15000 });

    // Right-click on the last rail entry (node-gamma). Playwright's
    // .click({button:'right'}) fires a native contextmenu with the
    // element's center as clientX/clientY — for the last entry in a
    // 300px-tall viewport, that lands well into the "would overflow
    // downward" zone.
    await page.locator('[data-node-list-alias="node-gamma"]').click({ button: 'right' });

    const menu = page.locator('[data-testid="node-context-menu"]');
    await expect(menu).toBeVisible({ timeout: 3000 });
    // Wait for the useLayoutEffect + re-render — flip only applies
    // after the second render. If flip did NOT fire, this attribute
    // stays absent → the timeout below reads "expected 'true', got null"
    // and the test reds precisely on the flip contract.
    await expect(menu).toHaveAttribute('data-flipped-y', 'true', { timeout: 2000 });

    // 🔴 Core assertion — menu is fully inside viewport (bottom edge
    // ≤ viewport bottom). Without the flip, the menu would render
    // from clientY down and have bottom > viewport.height.
    const rect = await menu.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    // Read current viewport (we set it to 1280×300 above).
    const vp = page.viewportSize()!;
    expect(rect.bottom).toBeLessThanOrEqual(vp.height);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(vp.width);

    // Sibling positive — the flip attribute is set (proves it took
    // the flip branch, not just happened to fit by luck).
    await expect(menu).toHaveAttribute('data-flipped-y', 'true');
  });
});
