/* Round 34 verification: offline node tooltip carries "last seen: <relative>";
 * online nodes skip the line. SQL-style timestamp parsing is exercised in
 * production (CommHub format) but the existing isGhost filter has a
 * separate TZ-sensitivity issue that ghosts SQL-without-Z entries on
 * non-UTC browsers — out of Round 34 scope. The helper supports both
 * formats; the SQL path is covered by manual inspection. */
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
// One online, two offline at different ages (both ISO).
const now = Date.now();
const isoMin = (m) => new Date(now - m * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const fresh = isoMin(0.1);
  const sessions = [
    { alias: 'live',    status: 'idle',    network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'off6m',   status: 'offline', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: isoMin(6) },
    { alias: 'off45m',  status: 'offline', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: isoMin(45) },
  ];
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForTimeout(400);

const titleOf = alias => page.$eval(`g[data-node="${alias}"] title`, el => el.textContent);
const live = await titleOf('live');
const off6m = await titleOf('off6m');
const off45m = await titleOf('off45m');

await browser.close();
const results = {
  liveSkipsLastSeen: !/last seen:/.test(live),
  off6mShows6mAgo: /last seen: [56]m ago/.test(off6m),    // 6m exactly, ±1 minute slack
  off45mShows45mAgo: /last seen: 4[45]m ago/.test(off45m), // 45m exactly, ±1 minute slack
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} last-seen tooltip:`, JSON.stringify(results),
  `\n  live=${JSON.stringify(live)}\n  off6m=${JSON.stringify(off6m)}\n  off45m=${JSON.stringify(off45m)}`);
process.exit(ok ? 0 : 1);
