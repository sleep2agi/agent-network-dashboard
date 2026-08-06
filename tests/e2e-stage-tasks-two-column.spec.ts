import { test, expect, Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3100';

// Stage-tasks — /tasks list-plus-detail two-column layout + shareable
// /tasks/[id] deep link. Migrated from the old one-big-table + inline
// expand + TaskDrawer implementation.
//
// Feature-parity target (通信龙 07-31 硬门, five blocks each with its
// own positive assertion + REAL data visible in the assertion — not
// just "the div is there"):
//   1. Timeline card         — 4 steps, real ISO timestamps
//   2. Info card             — 6 fields incl. task_id / from / to / expires
//   3. Content               — body text
//   4. Result                — body text (conditional on task.result)
//   5. Events feed           — /api/hub/task-events, 10s poll, real event rows
//
// Plus:
//   - Poll cadence assertions (5s task, 10s events) via data attributes
//   - Deep link (/tasks/[id]) direct-URL load selects that task
//   - Return entry (close button returns to /tasks + empty pane)
//   - Old full-page detail (`Task Detail` <h1>) no longer mounts, paired
//     with a positive assertion in the same test so "detail integrated
//     into pane" and "detail feature gone" can't be confused.
//
// Witnessed-red methodology: each of the five blocks was verified to
// fail its own specific assertion (and only that one) when its
// component in TaskDetail.tsx was temporarily commented out. See PR
// body for the recorded red assertion names.

const TASK_LIST_ID = 'task_alpha_20260731';
const TASK_DEEP_ID = 'task_deep_20260731';
const TASK_BETA_ID = 'task_beta_20260731';

const TASK_LIST_RESPONSE = {
  tasks: [
    {
      task_id: TASK_LIST_ID,
      network_id: 'net_test',
      from_name: 'sender-alpha',
      to_name: 'receiver-alpha',
      status: 'replied',
      priority: 'normal',
      content: 'ALPHA_CONTENT_LITERAL',
      result: 'ALPHA_RESULT_LITERAL',
      created_at: '2026-07-31 10:00:00',
      updated_at: '2026-07-31 10:00:05',
      delivered_at: '2026-07-31 10:00:01',
      started_at: '2026-07-31 10:00:02',
      completed_at: '2026-07-31 10:00:04',
      expires_at: '2026-08-01 10:00:00',
    },
    {
      task_id: TASK_BETA_ID,
      network_id: 'net_test',
      from_name: 'sender-beta',
      to_name: 'receiver-beta',
      status: 'failed',
      priority: 'high',
      content: 'BETA_CONTENT_LITERAL',
      result: '',
      created_at: '2026-07-31 09:00:00',
      updated_at: '2026-07-31 09:00:03',
      delivered_at: '2026-07-31 09:00:01',
      started_at: '',
      completed_at: '',
      expires_at: '',
    },
    {
      task_id: TASK_DEEP_ID,
      network_id: 'net_test',
      from_name: 'sender-deep',
      to_name: 'receiver-deep',
      status: 'running',
      priority: 'normal',
      content: 'DEEP_CONTENT_LITERAL',
      result: '',
      created_at: '2026-07-31 08:00:00',
      updated_at: '2026-07-31 08:00:02',
      delivered_at: '2026-07-31 08:00:01',
      started_at: '2026-07-31 08:00:02',
      completed_at: '',
      expires_at: '',
    },
  ],
  count: 3,
};

const TASK_DETAILS: Record<string, { tasks: (typeof TASK_LIST_RESPONSE.tasks)[0][] }> = {
  [TASK_LIST_ID]: { tasks: [TASK_LIST_RESPONSE.tasks[0]] },
  [TASK_BETA_ID]: { tasks: [TASK_LIST_RESPONSE.tasks[1]] },
  [TASK_DEEP_ID]: { tasks: [TASK_LIST_RESPONSE.tasks[2]] },
};

const TASK_EVENTS: Record<string, { events: Array<Record<string, unknown>> }> = {
  [TASK_LIST_ID]: {
    events: [
      {
        id: 1,
        event_type: 'ALPHA_EVENT_CREATED',
        from_status: '',
        to_status: 'created',
        detail: '',
        created_at: '2026-07-31 10:00:00',
      },
      {
        id: 2,
        event_type: 'ALPHA_EVENT_REPLIED',
        from_status: 'running',
        to_status: 'replied',
        detail: '',
        created_at: '2026-07-31 10:00:04',
      },
    ],
  },
  [TASK_BETA_ID]: { events: [] },
  [TASK_DEEP_ID]: {
    events: [
      {
        id: 3,
        event_type: 'DEEP_EVENT_STARTED',
        from_status: 'created',
        to_status: 'running',
        detail: '',
        created_at: '2026-07-31 08:00:02',
      },
    ],
  },
};

// Rate limit avoidance (10/15min/IP). Login once per worker, reuse
// the session cookie. Same pattern as e2e-stage-b-chat-pane.spec.ts.
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
    await context.addCookies([
      {
        name: 'anet_dashboard_session',
        value: cachedSessionCookie,
        domain: new URL(BASE).hostname,
        path: '/',
      },
    ]);
  }
}

async function mockAll(page: Page) {
  // /api/hub/tasks — matches both list (no task_id) and single-task
  // fetch (?task_id=…). Route handler inspects the URL.
  await page.route('**/api/hub/tasks**', (route) => {
    const url = route.request().url();
    const match = url.match(/[?&]task_id=([^&]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const detail = TASK_DETAILS[id];
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail || { tasks: [] }),
      });
      return;
    }
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TASK_LIST_RESPONSE),
    });
  });
  await page.route('**/api/hub/task-events**', (route) => {
    const url = route.request().url();
    const match = url.match(/[?&]task_id=([^&]+)/);
    const id = match ? decodeURIComponent(match[1]) : '';
    const events = TASK_EVENTS[id] || { events: [] };
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(events),
    });
  });
  // Prevent unrelated fetches from hanging tests.
  await page.route('**/api/hub/status**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"sessions":[]}' }),
  );
  await page.route('**/api/hub/nodes**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"nodes":[]}' }),
  );
  await page.route('**/api/hub/health', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"ok":true,"sse_sessions":{}}',
    }),
  );
  await page.route('**/api/hub/stats**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/hub/messages**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"messages":[]}' }),
  );
}

const layout = (page: Page) => page.locator('[data-testid="tasks-layout"]');
const detailPane = (page: Page) => page.locator('[data-testid="task-detail-pane"]');

test.describe('Stage-tasks — /tasks two-column list + detail', () => {
  test('list + selecting a task reveals the detail pane with 5 parity blocks', async ({
    page,
    context,
  }) => {
    await login(context);
    await mockAll(page);
    await page.goto(`${BASE}/tasks`);
    await expect(layout(page)).toBeVisible({ timeout: 15000 });

    // Before any selection: layout says nothing selected + no old h1.
    await expect(layout(page)).toHaveAttribute('data-selected-id', '');
    // Old full-page detail assertion (negative) — paired with positive
    // below in the SAME test so "detail feature entirely gone" cannot
    // masquerade as "old page gone".
    await expect(page.getByRole('heading', { level: 1, name: 'Task Detail' })).toHaveCount(0);

    // Click ALPHA row.
    await page
      .locator(`[data-task-row][data-task-id="${TASK_LIST_ID}"]`)
      .click();

    await expect(detailPane(page)).toBeVisible();
    await expect(detailPane(page)).toHaveAttribute('data-task-id', TASK_LIST_ID);
    await expect(layout(page)).toHaveAttribute('data-selected-id', TASK_LIST_ID);
    await expect(page).toHaveURL(`${BASE}/tasks/${TASK_LIST_ID}`);

    // ── Parity block #1: Timeline card ────────────────────────────
    await expect(page.locator('[data-testid="task-detail-timeline"]')).toBeVisible();
    // Real data — the ISO timestamp literal from the mock, present in
    // the "created" step's title tooltip.
    await expect(
      page.locator('[data-testid="timeline-step-created"]'),
    ).toContainText('2026-07-31 10:00:00');
    // "Completed" step has data-timeline-done=true because completed_at
    // is set. Also proves the "done" propagation is real, not fake.
    await expect(
      page.locator('[data-testid="timeline-step-completed"]'),
    ).toHaveAttribute('data-timeline-done', 'true');

    // ── Parity block #2: Info card ────────────────────────────────
    await expect(page.locator('[data-testid="task-detail-info"]')).toBeVisible();
    // task-id field carries the real id (not a truncated preview).
    await expect(
      page.locator('[data-info-field="task-id"]'),
    ).toContainText(TASK_LIST_ID);
    await expect(page.locator('[data-info-field="from"]')).toContainText('sender-alpha');
    await expect(page.locator('[data-info-field="to"]')).toContainText('receiver-alpha');
    await expect(page.locator('[data-info-field="expires"]')).toContainText(
      '2026-08-01 10:00:00',
    );

    // ── Parity block #3: Content ──────────────────────────────────
    await expect(
      page.locator('[data-testid="task-detail-content-body"]'),
    ).toContainText('ALPHA_CONTENT_LITERAL');

    // ── Parity block #4: Result ───────────────────────────────────
    await expect(
      page.locator('[data-testid="task-detail-result-body"]'),
    ).toContainText('ALPHA_RESULT_LITERAL');

    // ── Parity block #5: Events feed ──────────────────────────────
    await expect(page.locator('[data-testid="task-detail-events"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-detail-events"]')).toHaveAttribute(
      'data-events-count',
      '2',
    );
    // Real event data — literal event_type value from the mock.
    await expect(page.locator('[data-testid="task-detail-events"]')).toContainText(
      'ALPHA_EVENT_CREATED',
    );
    await expect(page.locator('[data-testid="task-detail-events"]')).toContainText(
      'ALPHA_EVENT_REPLIED',
    );

    // ── Poll cadence assertions ───────────────────────────────────
    // Do NOT widen these without a paired PR. See TaskDetail.tsx.
    await expect(detailPane(page)).toHaveAttribute('data-poll-task-ms', '5000');
    await expect(detailPane(page)).toHaveAttribute('data-poll-events-ms', '10000');
  });

  test('events block stays visible with "No events yet" when list is empty (not hidden)', async ({
    page,
    context,
  }) => {
    // BETA has zero events. If the block hid itself entirely we would
    // not be able to distinguish "feed removed" from "task has no
    // events" — so the empty state must be an explicit visible label.
    await login(context);
    await mockAll(page);
    await page.goto(`${BASE}/tasks/${TASK_BETA_ID}`);
    await expect(detailPane(page)).toBeVisible({ timeout: 15000 });

    await expect(page.locator('[data-testid="task-detail-events"]')).toBeVisible();
    await expect(page.locator('[data-testid="task-detail-events"]')).toHaveAttribute(
      'data-events-count',
      '0',
    );
    await expect(page.locator('[data-testid="task-detail-events"]')).toContainText(
      'No events yet',
    );
  });

  test('deep link — direct load /tasks/[id] selects that task', async ({ page, context }) => {
    await login(context);
    await mockAll(page);
    // Direct URL entry — NOT via clicking the list. This is the specific
    // path that's easy to break silently (click works, deep link does
    // not) — see 通信龙 07-31 witnessed-red requirement for this test.
    await page.goto(`${BASE}/tasks/${TASK_DEEP_ID}`);

    await expect(layout(page)).toBeVisible({ timeout: 15000 });
    await expect(layout(page)).toHaveAttribute('data-selected-id', TASK_DEEP_ID);
    await expect(detailPane(page)).toBeVisible();
    await expect(detailPane(page)).toHaveAttribute('data-task-id', TASK_DEEP_ID);
    // Real data check on the deep-link path: content literal is there.
    await expect(
      page.locator('[data-testid="task-detail-content-body"]'),
    ).toContainText('DEEP_CONTENT_LITERAL');
  });

  test('close button returns to /tasks and clears selection', async ({ page, context }) => {
    await login(context);
    await mockAll(page);
    await page.goto(`${BASE}/tasks/${TASK_LIST_ID}`);
    await expect(detailPane(page)).toBeVisible({ timeout: 15000 });

    await page.locator('[data-testid="task-detail-close"]').click();

    // Selection cleared + URL back to /tasks + empty pane placeholder
    // rendered on desktop (return-entry positive assertion).
    await expect(layout(page)).toHaveAttribute('data-selected-id', '');
    await expect(page).toHaveURL(`${BASE}/tasks`);
    // On desktop viewport (playwright default is desktop-sized),
    // the empty-state placeholder pane replaces the detail pane.
    await expect(page.locator('[data-testid="task-detail-empty"]')).toBeVisible();
    // Old full-page detail also NOT re-emerging as a fallback.
    await expect(page.getByRole('heading', { level: 1, name: 'Task Detail' })).toHaveCount(0);
  });
});
