import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const REQ_ID = 'req_link_1';

let cachedSessionCookie: string | null = null;

async function login(context: Page['context'] extends () => infer C ? C : never) {
  if (!cachedSessionCookie) {
    const res = await context.request.post(`${BASE}/api/auth/login`, {
      data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
    });
    const setCookie = res.headers()['set-cookie'] || '';
    const match = setCookie.match(/anet_dashboard_session=([^;]+)/);
    if (match) cachedSessionCookie = decodeURIComponent(match[1]);
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

async function mockRequirements(page: Page) {
  await page.route('**/api/hub/requirements**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/people')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, people: [{ kind: 'node', id: 'node_known', name: 'alias-only', display_name: '节点甲' }] }),
      });
      return;
    }
    if (path.endsWith('/stats')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          totals: { done: 2, doing: 1, pool: 1, abandoned: 0 },
          by_completer: [
            { kind: 'node', id: 'token:tok_example', n: 2, display_name: '节点甲' },
            { kind: 'node', id: 'token:tok_unnamed', n: 1 },
          ],
          recent: [{ id: REQ_ID, seq: 918, name: 'Ship the links', completed_by: { kind: 'node', id: 'token:tok_example', display_name: '节点甲' } }],
          daily: [{ date: '2026-10-11', n: 2 }],
        }),
      });
      return;
    }
    if (path.endsWith('/events')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          events: [{
            id: 'evt_1',
            requirement_id: REQ_ID,
            seq: 918,
            title: 'Ship the links',
            actor: { kind: 'node', id: 'token:tok_unnamed' },
            kind: 'changed',
            field: 'column',
            at: '2026-10-11T00:00:00Z',
          }],
        }),
      });
      return;
    }
    if (path.endsWith(`/${REQ_ID}`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          requirement: {
            id: REQ_ID,
            seq: 918,
            name: 'Ship the links',
            column: 'doing',
            priority: 'high',
            description: 'DETAIL_BODY_LITERAL',
            owner: null,
            agent_owner: { kind: 'node', id: 'node_known' },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        capabilities: ['column_abandoned'],
        requirements: [{
          id: REQ_ID,
          seq: 918,
          name: 'Ship the links',
          column: 'doing',
          priority: 'high',
        }],
      }),
    });
  });
}

test.describe('requirement deep links', () => {
  test('board title and #id open the task detail route', async ({ page, context }) => {
    await login(context);
    await mockRequirements(page);
    await page.goto(`${BASE}/board`);

    const seq = page.getByTestId('requirement-seq').first();
    await expect(seq).toBeVisible({ timeout: 15000 });
    await expect(seq).toHaveText('#918');
    await expect(seq).toHaveAttribute('href', `/board/${REQ_ID}`);
    const title = page.getByTestId('requirement-title').first();
    await expect(title).toHaveText('Ship the links');
    await expect(title).toHaveAttribute('href', `/board/${REQ_ID}`);

    await seq.click();
    await expect(page).toHaveURL(`${BASE}/board/${REQ_ID}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the links');
    await expect(page.getByText('DETAIL_BODY_LITERAL')).toBeVisible();
    await expect(page.getByText('节点甲')).toBeVisible();
  });

  test('list, activity, and dashboard keep the same detail links', async ({ page, context }) => {
    await login(context);
    await mockRequirements(page);

    await page.goto(`${BASE}/board?view=list`);
    await expect(page.getByTestId('requirement-seq').first()).toHaveAttribute('href', `/board/${REQ_ID}`);

    await page.goto(`${BASE}/board?view=activity`);
    await expect(page.getByTestId('requirement-title').first()).toHaveText('Ship the links');
    await expect(page.getByText('Agent').first()).toBeVisible();
    await expect(page.getByText('token:tok_')).toHaveCount(0);

    await page.goto(`${BASE}/board?view=dashboard`);
    await expect(page.getByRole('heading', { name: 'Recent completions' })).toBeVisible();
    await expect(page.getByTestId('requirement-seq').first()).toHaveAttribute('href', `/board/${REQ_ID}`);
    await expect(page.getByText('节点甲').first()).toBeVisible();
    await expect(page.getByText('Agent').first()).toBeVisible();
    await expect(page.getByText('token:tok_')).toHaveCount(0);
  });
});
