import { test, expect, Page, BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.TEST_URL || 'http://localhost:3000';
const OUTPUT = resolve(process.env.OSS_SCREENSHOT_DIR || 'test-results/oss-readme-visuals');

test.setTimeout(120_000);

const sessions = [
  { alias: 'planner-1', status: 'working', network_id: 'net_demo', runtime: 'codex-sdk' },
  { alias: 'research-1', status: 'working', network_id: 'net_demo', runtime: 'grok-build' },
  { alias: 'builder-1', status: 'idle', network_id: 'net_demo', runtime: 'opencode' },
  { alias: 'reviewer-1', status: 'working', network_id: 'net_demo', runtime: 'claude-code-cli' },
  { alias: 'release-1', status: 'idle', network_id: 'net_demo', runtime: 'codex-app-server' },
].map((session, index) => ({
  ...session,
  model: ['codex-5', 'grok-4', 'gpt-5', 'claude-sonnet', 'codex-5'][index],
  agent: session.runtime,
  server: 'demo-host',
  task: index < 3 ? 'Coordinating launch' : '',
  progress: index < 3 ? 65 + index * 10 : 0,
  updated_at: '2026-08-07T10:15:00Z',
}));

const nodes = sessions.map((session, index) => ({
  alias: session.alias,
  node_id: `demo-node-${index + 1}`,
  runtime: session.runtime,
  network_id: session.network_id,
  team: index < 3 ? 'Product' : 'Quality',
  tags: index < 3 ? ['build'] : ['review'],
}));

const chatTasks = [
  {
    task_id: 'demo-task-1', from_name: 'Dashboard', to_name: 'research-1', status: 'replied', priority: 'normal',
    content: 'Summarize the strongest user signal from this week and cite the supporting evidence.',
    result: 'The clearest signal is demand for one shared place to coordinate multiple AI agents. I grouped the evidence into workflow, reliability, and visibility themes.',
    created_at: '2026-08-07T10:00:00Z', updated_at: '2026-08-07T10:01:00Z',
  },
  {
    task_id: 'demo-task-2', from_name: 'Dashboard', to_name: 'research-1', status: 'replied', priority: 'high',
    content: 'Turn that into a launch brief for the build and review agents.',
    result: 'Launch brief ready:\n\n- show the live agent network\n- keep every task reply in one conversation\n- make ownership and status visible at a glance',
    created_at: '2026-08-07T10:04:00Z', updated_at: '2026-08-07T10:05:00Z',
  },
  {
    task_id: 'demo-task-3', from_name: 'reviewer-1', to_name: 'research-1', status: 'replied', priority: 'normal',
    content: 'Can you verify the brief contains no private customer data?',
    result: 'Verified. The brief uses synthetic examples only and is ready for public review.',
    created_at: '2026-08-07T10:12:00Z', updated_at: '2026-08-07T10:13:00Z',
  },
];

let sessionCookie: string | null = null;

async function login(context: BrowserContext) {
  if (!sessionCookie) {
    const response = await context.request.post(`${BASE}/api/auth/login`, {
      data: { password: process.env.ANET_DASHBOARD_PASSWORD || 'admin123' },
    });
    const cookie = (response.headers()['set-cookie'] || '').match(/anet_dashboard_session=([^;]+)/);
    if (!cookie) throw new Error('dashboard login did not return a session cookie');
    sessionCookie = decodeURIComponent(cookie[1]);
  }
  await context.addCookies([{
    name: 'anet_dashboard_session', value: sessionCookie,
    domain: new URL(BASE).hostname, path: '/', sameSite: 'Lax',
  }]);
}

async function mockDemoNetwork(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('anet-theme', 'cyber');
    window.sessionStorage.setItem('anet_network_id', 'net_demo');
  });
  await page.route('**/api/hub/status**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ sessions }),
  }));
  await page.route('**/api/hub/nodes**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ nodes }),
  }));
  await page.route('**/api/hub/networks**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ networks: [{ network_id: 'net_demo', network_name: 'Demo network' }] }),
  }));
  await page.route('**/api/hub/health**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true, version: 'demo', sse_connections: sessions.length,
      sse_sessions: Object.fromEntries(sessions.map(session => [`net_demo:${session.alias}`, 1])),
    }),
  }));
  await page.route('**/api/hub/tasks**', route => {
    const url = new URL(route.request().url());
    const target = url.searchParams.get('to_name');
    const tasks = target ? chatTasks.filter(task => task.to_name === target) : chatTasks;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ tasks, total: tasks.length, _hint: {} }),
    });
  });
  await page.route('**/api/hub/task-events**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }),
  }));
  await page.route('**/api/hub/stats**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      tasks: { total: 3, by_status: [{ status: 'replied', count: 3 }] },
      nodes: { total: 5 },
    }),
  }));
  await page.route('**/api/hub/messages**', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ messages: [
      {
        id: 'demo-message-1', type: 'message', from_alias: 'dashboard', to_alias: 'research-1', priority: 'normal',
        content: 'Summarize the strongest user signal from this week and cite the supporting evidence.',
        created_at: '2026-08-07T10:00:00Z',
      },
      {
        id: 'demo-message-2', type: 'reply', from_alias: 'research-1', to_alias: 'dashboard', priority: 'normal',
        content: 'The clearest signal is demand for one shared place to coordinate multiple AI agents.',
        created_at: '2026-08-07T10:01:00Z',
      },
      {
        id: 'demo-message-3', type: 'message', from_alias: 'dashboard', to_alias: 'research-1', priority: 'high',
        content: 'Turn that into a launch brief for the build and review agents.',
        created_at: '2026-08-07T10:04:00Z',
      },
      {
        id: 'demo-message-4', type: 'reply', from_alias: 'research-1', to_alias: 'dashboard', priority: 'normal',
        content: 'Launch brief ready: show the live network, keep replies in one conversation, and make ownership visible at a glance.',
        created_at: '2026-08-07T10:05:00Z',
      },
    ] }),
  }));
  await page.route('**/api/hub/events**', route => route.fulfill({
    status: 200, contentType: 'text/event-stream', body: '',
  }));
  await page.route('**/api/anet/node-config**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ model: 'demo/model', flags: {}, channels: [], config_revision: 1 }),
  }));
}

test.beforeAll(() => mkdirSync(OUTPUT, { recursive: true }));

test('capture the conversation-first command view', async ({ page, context }) => {
  await login(context);
  await mockDemoNetwork(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded' });
  const chat = page.locator('[data-testid="messages-shell"]');
  await expect(chat).toBeVisible({ timeout: 60_000 });
  await expect(chat.getByText('Launch brief ready:', { exact: false })).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: join(OUTPUT, 'dashboard-chat.png'), fullPage: false });
});

test('capture the live agent network topology', async ({ page, context }) => {
  await login(context);
  await mockDemoNetwork(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const showcase = page.locator('section[data-topo-showcase]');
  await expect(showcase).toBeVisible({ timeout: 60_000 });
  const topology = showcase.locator('svg[aria-roledescription="agent network topology"]');
  await expect(topology).toBeVisible({ timeout: 60_000 });
  await expect(topology).toHaveAttribute('aria-label', /5 agents online/);
  await page.waitForTimeout(800);
  await showcase.screenshot({ path: join(OUTPUT, 'dashboard-topology.png') });
});
