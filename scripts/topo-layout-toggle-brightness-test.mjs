/* Round 597 verification: Layout Ring/Grid segmented buttons
 * gain hover:brightness-[1.15]. 37+38th anchors (6+7th HTML).
 * Paired-anchor round closing the 2nd segmented control at
 * brightness parity (R596 was zoom +/-).
 *
 * Test phases:
 *   1. mock nodes → chrome strip renders Ring + Grid buttons
 *   2. rest: filter='none', brightness-hover-attr='1.15'
 *   3. computed transition-property contains 'filter'
 *   4. source: hover:brightness-[1.15] + 'filter 150ms ease' in
 *      inline transition list
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const ring = document.querySelector('[data-topo-chrome-layout="ring"]');
  const grid = document.querySelector('[data-topo-chrome-layout="grid"]');
  if (!ring || !grid) return null;
  return {
    ring: {
      filter: getComputedStyle(ring).filter,
      transitionProperty: getComputedStyle(ring).transitionProperty,
      brightnessHoverAttr: ring.getAttribute('data-topo-chrome-layout-ring-brightness-hover'),
      ariaLabel: ring.textContent,
    },
    grid: {
      filter: getComputedStyle(grid).filter,
      transitionProperty: getComputedStyle(grid).transitionProperty,
      brightnessHoverAttr: grid.getAttribute('data-topo-chrome-layout-grid-brightness-hover'),
      ariaLabel: grid.textContent,
    },
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRingFilter = /data-topo-chrome-layout="ring"[\s\S]*?hover:brightness-\[1\.15\]/.test(src);
const sourceGridFilter = /data-topo-chrome-layout="grid"[\s\S]*?hover:brightness-\[1\.15\]/.test(src);
const sourceRingTransition = /data-topo-chrome-layout="ring"[\s\S]*?filter 150ms ease/.test(src);
const sourceGridTransition = /data-topo-chrome-layout="grid"[\s\S]*?filter 150ms ease/.test(src);

const results = {
  both_buttons_present:   !!rest,
  ring_rest_filter_none:  rest?.ring.filter === 'none',
  grid_rest_filter_none:  rest?.grid.filter === 'none',
  ring_hover_attr_115:    rest?.ring.brightnessHoverAttr === '1.15',
  grid_hover_attr_115:    rest?.grid.brightnessHoverAttr === '1.15',
  ring_label:             /ring/i.test(rest?.ring.ariaLabel || ''),
  grid_label:             /grid/i.test(rest?.grid.ariaLabel || ''),
  ring_transition_filter: /filter/.test(rest?.ring.transitionProperty || ''),
  grid_transition_filter: /filter/.test(rest?.grid.transitionProperty || ''),
  source_ring_filter:     sourceRingFilter,
  source_grid_filter:     sourceGridFilter,
  source_ring_transition: sourceRingTransition,
  source_grid_transition: sourceGridTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R597 Ring/Grid brightness (37+38th anchors, 2nd segmented control closure):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
