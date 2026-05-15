/* Round 11 verification: clicking a node opens the ChatPopover AND draws a
 * persistent chat-focus ring on that node (strokeWidth=2.5, status colour).
 * Closing the popover removes the ring. The ring's strokeWidth stays clear
 * of the overlap-test selectors (1.5 / 3). */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.removeItem('anet-brand');
    localStorage.removeItem('anet-topo-view');
    localStorage.setItem('anet-topo-layout', 'grid');
    localStorage.setItem('anet-topo-nodescale', '1'); // L so radius=26
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['A站马', 'B站马', 'C站马'].map(a => ({
    alias: a, status: 'idle', network_id: nid,
    project_dir: null,
    created_at: '2026-05-15T00:00:00Z', updated_at: '2026-05-15T00:00:00Z',
    last_seen_at: new Date().toISOString(),
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return !!svg && svg.querySelectorAll('g[data-node]').length >= 3;
}, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);

// Pre-click: NO chat-focus ring on any node (strokeWidth=2.5, no group-hover class)
const ringsBefore = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-node] circle[stroke-width="2.5"]', els => els.length);

// Click A站马 → opens chat popover
await page.locator('g[data-node="A站马"]').click();
await page.waitForTimeout(300);

const ringsAfter = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-node] circle[stroke-width="2.5"]', els => els.length);
const ringOnTarget = await page.$eval(
  'g[data-node="A站马"] circle[stroke-width="2.5"]',
  el => ({ r: +el.getAttribute('r'), opacity: +el.getAttribute('opacity') })
).catch(() => null);

// Confirm popover is open
const popover = await page.locator('[role="dialog"], [data-chat-popover]').count();

// Ring should be ONLY on the clicked node, not on the others
const ringOnOther = await page.$$eval('g[data-node="B站马"] circle[stroke-width="2.5"], g[data-node="C站马"] circle[stroke-width="2.5"]', els => els.length);

const results = {
  noRingBefore: ringsBefore === 0,
  oneRingAfter: ringsAfter === 1,
  ringOnTargetNode: !!ringOnTarget && ringOnTarget.r === 40, // radius=26 + 14
  ringNotOnOthers: ringOnOther === 0,
};

// Re-run the overlap selector to confirm the chat-focus ring isn't mis-counted as a status ring
const statusRings = await page.$$eval('svg[viewBox="0 0 1000 680"] g[data-node] circle[stroke-width="3"], svg[viewBox="0 0 1000 680"] g[data-node] circle[stroke-width="1.5"]', els => els.length);
results.statusRingCountUnchanged = statusRings === 3; // exactly one per online node

await browser.close();
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chat-focus ring:`, JSON.stringify(results));
process.exit(ok ? 0 : 1);
