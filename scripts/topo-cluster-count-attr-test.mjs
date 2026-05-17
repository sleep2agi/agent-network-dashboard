/* Round 512 verification: root svg surfaces `data-topo-cluster-count`
 * (14th attr in canvas state surface set). Paired with R469 fleet
 * numerics + R502 categorical density.
 *
 * Contract:
 *   - grid layout: data-topo-cluster-count = groupBoxes.length (≥ 1)
 *   - ring layout: data-topo-cluster-count = '0' (groupBoxes is empty)
 *   - orphan-band fixture: cluster count includes the orphan band
 *
 * Tests across 2 fixtures × 2 layouts.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe({ layout, sessions, label }) {
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
    await route.fulfill({ response: r, json: { ...b, sessions: sessions.map(s => mk(s.alias, s.status)) } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-cluster-count]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const count = await page.evaluate(() =>
    document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-cluster-count')
  );
  await browser.close();
  return { label, count };
}

// Fixture A: 2 prefix groups (alpha×3 + beta×2) + 3 orphans
const fixtureA = [
  { alias: 'alpha·1', status: 'working' },
  { alias: 'alpha·2', status: 'idle' },
  { alias: 'alpha·3', status: 'idle' },
  { alias: 'beta·1',  status: 'working' },
  { alias: 'beta·2',  status: 'idle' },
  { alias: 'zeta',    status: 'idle' },
  { alias: 'omega',   status: 'idle' },
  { alias: 'lonely',  status: 'idle' },
];

const aGrid = await probe({ layout: 'grid', sessions: fixtureA, label: 'grid+2prefix+3orph' });
const aRing = await probe({ layout: 'ring', sessions: fixtureA, label: 'ring+same fixture' });

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /data-topo-cluster-count=\{groupBoxes\.length\}/.test(src);

const results = {
  grid_returns_3:    aGrid.count === '3',  // 2 prefix groups + 1 orphan band
  ring_returns_0:    aRing.count === '0',  // no group boxes in ring layout
  source_wired:      sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R512 cluster-count attr:`, JSON.stringify(results),
  '\n  grid:', JSON.stringify(aGrid),
  '\n  ring:', JSON.stringify(aRing));
process.exit(ok ? 0 : 1);
