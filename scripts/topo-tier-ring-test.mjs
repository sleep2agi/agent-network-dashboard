/* Round 54 verification: tier-radius guide rings render at the active
 * tier radii only, picked from the online node count.
 *  - N ≤ 8  → 1 ring at r=220
 *  - 9-14   → 2 rings at r=175 and r=260
 *  - N > 14 → 3 rings at r=145, 215, 285
 *  - Grid layout has NO tier rings (they're ring-only).
 * Identified via the `data-tier-ring` attribute the implementation
 * stamps on each guide circle. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

async function probe(layout, count) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((layout) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', layout);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, layout);
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const sessions = Array.from({ length: count }).map((_, i) => ({
      alias: `n${i.toString().padStart(2, '0')}`,
      status: 'idle', network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    }));
    await route.fulfill({ response: r, json: { ...b, sessions } });
  });
  await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(c => document.querySelectorAll('g[data-node]').length === c, count, { timeout: 30000 });
  await page.waitForTimeout(400);
  const radii = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return [...svg.querySelectorAll('circle[data-tier-ring]')]
      .map(c => +c.getAttribute('data-tier-ring'))
      .sort((a, b) => a - b);
  });
  await ctx.close();
  return radii;
}

const single = await probe('ring', 6);
const dual = await probe('ring', 12);
const triple = await probe('ring', 22);
const grid = await probe('grid', 6);

await browser.close();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const results = {
  singleHas220: eq(single, [220]),
  dualHas175And260: eq(dual, [175, 260]),
  tripleHas145_215_285: eq(triple, [145, 215, 285]),
  gridHasNoTierRings: eq(grid, []),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} tier rings:`, JSON.stringify(results),
  `\n  single=${JSON.stringify(single)} dual=${JSON.stringify(dual)} triple=${JSON.stringify(triple)} grid=${JSON.stringify(grid)}`);
process.exit(ok ? 0 : 1);
