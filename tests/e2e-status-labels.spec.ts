import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// 通信龙 07-31 GAP 2nd tier: message status → human labels.
//
// This spec asserts BOTH:
//   (A) each known status renders the exact expected Chinese label,
//       NOT the raw English word ("已推送", not "delivered")
//   (B) an unknown status (hub adds a new one; front-end hasn't caught
//       up) is rendered fail-loudly — the raw string is visible AND a
//       "未知状态" banner appears in the hover text
//   (C) failed with `result` renders inline reason (first 40 chars);
//       failed without `result` renders "节点未提供原因". Both branches
//       — because a test that only covers "with reason" would let an
//       empty-result bug fall back to "未知错误" silently.
//
// Injection strategy: /api/hub/tasks?to_name=... is the message-list
// endpoint (grepped from TaskChatPanel.tsx:686). We stub it with an
// array of tasks, one per status, and read the rendered labels off
// data-status-key / data-status-label attributes. NO mock of the
// component itself — the render is the wire under test.
//
// Note on `chat-pane` gate: TaskChatPanel is inside the ChatPane
// column, which mounts on /nodes/<alias>. We goto /nodes/node-a to
// force ChatPane mount, then feed all the varying-status tasks as
// to_name=node-a so they all render in that chat.

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

// One-line-per-status expectation table. Duplicated deliberately from
// the component — a test that reads the label out of STATUS_INFO would
// prove nothing (it'd assert the map equals itself). These strings ARE
// the contract 通信龙 signed off on; if they change, this test reds.
const CASES: Array<{ status: string; label: string; hoverContains: string; known: boolean }> = [
  { status: 'queued',    label: '排队中', hoverContains: '已入队，尚未推给节点',       known: true },
  { status: 'delivered', label: '已推送', hoverContains: 'hub 侧已标记推送',            known: true },
  { status: 'acked',     label: '已接收', hoverContains: '未必已处理',                  known: true },
  { status: 'replied',   label: '已回复', hoverContains: '对方已针对此消息回复',        known: true },
  { status: 'failed',    label: '失败',   hoverContains: '发送失败',                    known: true },
  { status: 'created',   label: '发送中', hoverContains: '客户端已建消息',              known: true },
  { status: 'closed',    label: '已关闭', hoverContains: '会话已被关闭',                known: true },
  { status: 'expired',   label: '已超时', hoverContains: '在期限内未收到回复',          known: true },
  { status: 'cancelled', label: '已取消', hoverContains: '任务被主动取消',              known: true },
  { status: 'nonsense_hub_added_a_new_code', label: 'nonsense_hub_added_a_new_code', hoverContains: '未知状态', known: false },
];

function makeFixtureTasks() {
  return CASES.map((c, i) => ({
    task_id: `t_${c.status}_${i}`,
    from_node_id: 'n_a',
    from_name: 'node-a',
    to_node_id: 'n_a',
    to_name: 'node-a',
    priority: 'normal',
    status: c.status,
    content: `case-${c.status}`,
    result: '',
    in_reply_to: null,
    requires_response: 0,
    scope: 'inbox',
    created_at: `2026-07-31T10:0${i}:00`,
    delivered_at: `2026-07-31T10:0${i}:00`,
    started_at: null,
    completed_at: null,
    expires_at: null,
    meta_json: null,
  }));
}

async function stubHub(page: Page, tasks: object[]) {
  await page.route('**/api/hub/status**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessions: [{ alias: 'node-a', status: 'idle', network_id: 'net_x' }] }) }));
  await page.route('**/api/hub/nodes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ nodes: [{ alias: 'node-a', node_id: 'n_a', team: null, tags: [], attrs_revision: 0 }] }) }));
  await page.route('**/api/hub/networks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ networks: [{ network_id: 'net_x', network_name: 'net_x' }] }) }));
  await page.route('**/api/hub/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, version: '0.9.0-test', sse_connections: 1, sse_sessions: { 'net_x:node-a': 1 } }) }));
  await page.route('**/api/hub/stats**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await page.route('**/api/hub/messages**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [] }) }));
  await page.route('**/api/hub/events**', r =>
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  // /api/hub/tasks — TaskChatPanel:686 uses this for the message list.
  // Return our fixture regardless of query args (to_name, task_id, etc).
  await page.route('**/api/hub/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks }) }));
}

test.describe('Status labels — per-status render + unknown fail-loudly + failed both branches', () => {
  test('every known status renders its exact Chinese label with matching hover text', async ({ page, context }) => {
    await login(context);
    await stubHub(page, makeFixtureTasks());
    await page.goto(`${BASE}/nodes/node-a`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    // Premise: at least CASES.length StatusBars rendered — else we'd
    // be asserting into an empty page (see feedback_checker_scope_bug_vacuous_pass).
    const anyStatusBar = page.locator('[data-status-key]');
    await expect(anyStatusBar.first()).toBeVisible({ timeout: 10000 });
    const rendered = await anyStatusBar.count();
    expect(rendered, `expected at least ${CASES.length} StatusBar renders (one per case), got ${rendered}`)
      .toBeGreaterThanOrEqual(CASES.length);

    // Now assert each case individually. Locate by data-status-key
    // (unique per status in our fixture).
    for (const c of CASES) {
      const bar = page.locator(`[data-status-key="${c.status}"]`).first();
      await expect(bar).toBeVisible();

      // (A) label text is the exact Chinese string (or raw for unknown).
      const labelAttr = await bar.getAttribute('data-status-label');
      expect(labelAttr, `${c.status} label attr`).toBe(c.label);

      const visibleText = await bar.locator('span').first().textContent();
      expect(visibleText?.trim(), `${c.status} rendered text`).toContain(c.label);

      // (A cont.) known/unknown attr matches expectation.
      const knownAttr = await bar.getAttribute('data-status-known');
      expect(knownAttr, `${c.status} known attr`).toBe(c.known ? 'true' : 'false');

      // (B) hover title contains the semantic-specific string.
      const titleAttr = await bar.locator('span[title]').first().getAttribute('title');
      expect(titleAttr ?? '', `${c.status} hover text`).toContain(c.hoverContains);
    }
  });

  test('failed WITH result renders inline reason (first 40 chars)', async ({ page, context }) => {
    await login(context);
    const REASON = 'codex-sdk 返回空响应 (in=15806 out=19) — 疑似 vendor 静默限流/配额';
    const tasks = [{
      task_id: 't_failed_with_reason', from_node_id: 'n_a', from_name: 'node-a',
      to_node_id: 'n_a', to_name: 'node-a', priority: 'normal', status: 'failed',
      content: 'failed case', result: REASON, in_reply_to: null,
      requires_response: 0, scope: 'inbox',
      created_at: '2026-07-31T10:00:00', delivered_at: '2026-07-31T10:00:00',
      started_at: null, completed_at: null, expires_at: null, meta_json: null,
    }];
    await stubHub(page, tasks);
    await page.goto(`${BASE}/nodes/node-a`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    const bar = page.locator('[data-status-key="failed"]').first();
    await expect(bar).toBeVisible({ timeout: 10000 });

    // Premise: `result` on the fixture is a specific non-empty string.
    // If our stub fails to reach the component, the reason element
    // would still exist with '节点未提供原因' — that'd look like a
    // "wrong branch chosen" bug rather than "fixture never landed".
    // Asserting the exact first-40 slice catches both.
    const reason = bar.locator('[data-status-reason]');
    await expect(reason).toBeVisible();
    const reasonAttr = await reason.getAttribute('data-status-reason');
    const expected40 = REASON.slice(0, 40);
    expect(reasonAttr, `first-40 slice of "${REASON}"`).toBe(expected40);
    // Visible text mirrors the attribute (truncated via CSS if wider).
    expect(await reason.textContent()).toContain(expected40);
  });

  test('failed WITHOUT result renders "节点未提供原因" (not silently blank, not "未知错误")', async ({ page, context }) => {
    await login(context);
    const tasks = [{
      task_id: 't_failed_no_reason', from_node_id: 'n_a', from_name: 'node-a',
      to_node_id: 'n_a', to_name: 'node-a', priority: 'normal', status: 'failed',
      content: 'failed no reason', result: '',  // ← explicit empty
      in_reply_to: null, requires_response: 0, scope: 'inbox',
      created_at: '2026-07-31T10:00:00', delivered_at: '2026-07-31T10:00:00',
      started_at: null, completed_at: null, expires_at: null, meta_json: null,
    }];
    await stubHub(page, tasks);
    await page.goto(`${BASE}/nodes/node-a`);
    await expect(page.locator('[data-testid="chat-pane"]').first()).toBeVisible({ timeout: 15000 });

    const bar = page.locator('[data-status-key="failed"]').first();
    await expect(bar).toBeVisible({ timeout: 10000 });

    const reason = bar.locator('[data-status-reason]');
    await expect(reason).toBeVisible();
    const reasonAttr = await reason.getAttribute('data-status-reason');
    expect(reasonAttr).toBe('节点未提供原因');
    // Specifically NOT the "未知错误" placeholder — that would obscure
    // the distinction between "hub has no reason field" and "reason
    // exists but was bad", which is the whole point of separating them.
    expect(reasonAttr).not.toContain('未知错误');
  });
});
