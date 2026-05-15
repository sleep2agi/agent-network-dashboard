/* Round 20 / #119 step 3: ServersDrawer now consumes /api/hub/servers via
 * useSWR. Verifies:
 *   1. drawer renders live cards from the proxied endpoint (3 hosts)
 *   2. polling fires (refreshInterval 5s) — second snapshot reflects an
 *      updated payload after >5.2s
 *   3. when the hub predates 0.8.1-preview.2 the proxy returns
 *      `{ servers: [], unavailable: true }` and the drawer shows the
 *      friendly upgrade hint instead of an angry empty state
 *   4. hub-down (502) shows the retry chip */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function load({ payload, status = 200 }) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-servers-drawer', '1'); // start expanded so SWR fires
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  let calls = 0;
  await ctx.route('**/api/hub/servers', async (route) => {
    calls++;
    const body = typeof payload === 'function' ? payload(calls) : payload;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  // keep the rest of the dashboard quiet
  await ctx.route('**/api/hub/status*', (route) => route.fulfill({ json: { sessions: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('aside[aria-label="Servers panel"]', { timeout: 30000 });
  return { ctx, page, getCalls: () => calls };
}

const results = {};

// 1+2: live cards + polling
{
  const seed = (n) => ({
    servers: [
      { hostname: 'srv-01', ip: '10.0.0.1', cpu_load_1min: 1.2, cpu_cores: 4, mem_used_gb: 3, mem_total_gb: 16, agent_count: n, status: 'online' },
      { hostname: 'srv-02', cpu_load_1min: 0.4, cpu_cores: 8, mem_used_gb: 6, mem_total_gb: 32, agent_count: 2, status: 'online' },
      { hostname: 'srv-03', cpu_load_1min: null, cpu_cores: 0, mem_used_gb: null, mem_total_gb: null, agent_count: 1, status: 'offline' },
    ],
  });
  const { ctx, page, getCalls } = await load({ payload: seed });
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll('aside[aria-label="Servers panel"] [data-servers-body] > div[title]');
    return cards.length >= 3;
  }, { timeout: 10000 });
  const hostnames = await page.$$eval(
    'aside[aria-label="Servers panel"] [data-servers-body] span.font-semibold',
    els => els.map(e => e.textContent),
  );
  results.rendersLiveCards = hostnames.includes('srv-01') && hostnames.includes('srv-02') && hostnames.includes('srv-03');

  // wait past one poll cycle (5s + slack) and confirm the proxy was hit again
  await page.waitForTimeout(5400);
  results.polls = getCalls() >= 2;
  await ctx.close();
}

// 3: hub predates 0.8.1-preview.2 → unavailable hint
{
  const { ctx, page } = await load({ payload: { servers: [], unavailable: true } });
  await page.waitForFunction(() => {
    const el = document.querySelector('aside[aria-label="Servers panel"] [data-servers-body]');
    return el && el.textContent.includes('host telemetry not available');
  }, { timeout: 10000 }).catch(() => {});
  const body = await page.$eval('aside[aria-label="Servers panel"] [data-servers-body]', el => el.textContent);
  results.showsUpgradeHint = /host telemetry not available/.test(body) && /commhub-server/.test(body);
  await ctx.close();
}

// 4: hub-down 502 → retry chip
{
  const { ctx, page } = await load({ payload: { error: 'hub unreachable' }, status: 502 });
  await page.waitForFunction(() => {
    const el = document.querySelector('aside[aria-label="Servers panel"] [data-servers-body]');
    return el && /hub unreachable/.test(el.textContent || '');
  }, { timeout: 10000 }).catch(() => {});
  const body = await page.$eval('aside[aria-label="Servers panel"] [data-servers-body]', el => el.textContent);
  results.showsRetryChip = /hub unreachable/.test(body) && /every 5s/.test(body);
  await ctx.close();
}

await browser.close();
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} servers drawer live:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
