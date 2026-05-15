/* Round 35 verification: SQL-style timestamps (CommHub format) parse as
 * UTC regardless of the browser's local timezone. Reproduces the latent
 * bug from Round 34 — a 30-min-old offline node would have been ghosted
 * on a UTC+8 browser without parseHubTime. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

// SQL-style timestamp = ISO with the T replaced by space and Z stripped.
// This is exactly what the CommHub returns (see /api/status probe).
const sqlMin = (m) => {
  const d = new Date(Date.now() - m * 60 * 1000);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
};

async function probe(timezoneId) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'grid');
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  });
  const fresh = sqlMin(0.1);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = [
      { alias: 'live',  status: 'idle',    network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: fresh },
      { alias: 'off30', status: 'offline', network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: sqlMin(30) },   // 30 min ago, SQL format
      { alias: 'ghost', status: 'offline', network_id: nid, project_dir: null,
        created_at: fresh, updated_at: fresh, last_seen_at: sqlMin(75) },   // 75 min ago — should ghost
    ];
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('svg[viewBox="0 0 1000 680"]', { timeout: 30000 });
  await page.waitForTimeout(600);
  const rendered = await page.$$eval('g[data-node]', els => els.map(e => e.getAttribute('data-node')));
  await ctx.close();
  return rendered;
}

const utc = await probe('UTC');
const shanghai = await probe('Asia/Shanghai');     // UTC+8 — the failing case before Round 35
const losAngeles = await probe('America/Los_Angeles'); // UTC-7/8 — the opposite skew
await browser.close();

const expectsLiveAndOff30 = list =>
  list.includes('live') && list.includes('off30') && !list.includes('ghost');

const results = {
  utcRendersLiveAndOff30: expectsLiveAndOff30(utc),
  shanghaiRendersLiveAndOff30: expectsLiveAndOff30(shanghai),
  losAngelesRendersLiveAndOff30: expectsLiveAndOff30(losAngeles),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} TZ-safe ghost:`, JSON.stringify(results),
  `\n  UTC=${JSON.stringify(utc)}\n  Asia/Shanghai=${JSON.stringify(shanghai)}\n  America/Los_Angeles=${JSON.stringify(losAngeles)}`);
process.exit(ok ? 0 : 1);
