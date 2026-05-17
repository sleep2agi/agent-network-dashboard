/* Round 516 verification: root svg surfaces `data-topo-grid-content-
 * bottom` (17th attr). Reflects gridContentBottom state.
 *
 * Test phases:
 *   1. grid layout: attr is a positive number (actual pixel y-coord)
 *   2. ring layout: attr is '0' (no grid content)
 *   3. source-side regex confirms wiring
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(layout) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', l);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, layout);
  await ctx.route('**/api/hub/status*', async (route) => {
    const r = await route.fetch();
    const b = await r.json();
    const nid = (b.sessions || [])[0]?.network_id || 'default';
    const mk = (alias, status) => ({
      alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
      network_id: nid, project_dir: null,
      created_at: fresh, updated_at: fresh, last_seen_at: fresh,
    });
    await route.fulfill({ response: r, json: { ...b, sessions: [
      mk('alpha·1', 'working'),
      mk('alpha·2', 'idle'),
      mk('beta·1',  'idle'),
      mk('beta·2',  'idle'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-grid-content-bottom]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const attr = await page.evaluate(() =>
    document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-grid-content-bottom')
  );
  await browser.close();
  return attr;
}

const grid = await probe('grid');
const ring = await probe('ring');

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /data-topo-grid-content-bottom=\{gridContentBottom\}/.test(src);

const gridNum = parseInt(grid || '0', 10);

const results = {
  grid_is_positive:    gridNum > 0,
  grid_within_viewBox: gridNum > 0 && gridNum <= 680,
  ring_returns_0:      ring === '0',
  source_wired:        sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R516 grid-content-bottom attr:`, JSON.stringify(results),
  '\n  grid:', grid, '/ ring:', ring);
process.exit(ok ? 0 : 1);
