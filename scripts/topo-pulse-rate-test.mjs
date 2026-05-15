/* Round 24 verification: working-node pulse duration tiers by sse:N.
 *   sse 0-1 → 1.2s    (calm)
 *   sse 2-3 → 0.9s    (active)
 *   sse ≥ 4 → 0.7s    (busy)
 * Inject sse counts via mocked /api/hub/health → sse_sessions map. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
// Three working sessions with different sse counts. Use a known network_id
// so the `${nid}:${alias}` sse-map key works (the page's grouped lookup).
const NID = 'net_test';
await ctx.route('**/api/hub/status*', async (route) => {
  await route.fulfill({ json: {
    ok: true,
    sessions: ['calm', 'active', 'busy'].map(alias => ({
      alias, status: 'working', network_id: NID, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    })),
  } });
});
await ctx.route('**/api/hub/health*', async (route) => {
  await route.fulfill({ json: {
    ok: true,
    version: '0.8.0-test',
    sse_sessions: {
      [`${NID}:calm`]: 1,
      [`${NID}:active`]: 2,
      [`${NID}:busy`]: 4,
    },
  } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-node]').length === 3;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(600);

const durOf = alias => page.$eval(
  `g[data-node="${alias}"] circle[data-pulse-dur]`,
  el => el.getAttribute('data-pulse-dur'),
).catch(() => null);

const calm = await durOf('calm');
const active = await durOf('active');
const busy = await durOf('busy');

await browser.close();
const results = {
  calmIs1_2s: calm === '1.2s',
  activeIs0_9s: active === '0.9s',
  busyIs0_7s: busy === '0.7s',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pulse rate:`, JSON.stringify(results), `calm=${calm} active=${active} busy=${busy}`);
process.exit(ok ? 0 : 1);
