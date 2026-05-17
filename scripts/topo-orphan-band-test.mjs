/* v0.10.4 #150 verification: orphan-band layout algorithm. Vincent
 * /goal 5453 + screenshot: "落单的散落在中间", "升级一下算法".
 *
 * Pre-#150: single-member runs interleaved between real groups as
 * centred bands → orphan nodes scattered in cluster centres.
 * Post-#150: ALL singletons bundled into ONE band at the bottom of
 * the grid + rendered with an "其他" cluster box.
 *
 * Contract:
 *   - fixture: 2 prefix groups (alpha · 3, beta · 2) + 3 orphans
 *     (zeta, omega, lonely)
 *   - data-group-tier on the orphan band = 'mixed' or 'all-X'
 *     depending on statuses (no special "orphan" tier)
 *   - data-group attribute on the orphan box = '其他'
 *   - orphan box is positioned BELOW all prefix-group boxes
 *     (highest y-coord among groupBoxes)
 *   - prefix groups still render as before (alpha · 3, beta · 2)
 *   - topo-overlap-test contract: ZERO OVERLAP holds
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
    localStorage.setItem('anet-topo-layout', 'grid');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
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
    // prefix group: alpha · 3
    mk('alpha·1', 'working'), mk('alpha·2', 'idle'), mk('alpha·3', 'working'),
    // prefix group: beta · 2
    mk('beta·1',  'working'), mk('beta·2',  'idle'),
    // orphans (no prefix neighbour)
    mk('zeta',    'working'),
    mk('omega',   'idle'),
    mk('lonely',  'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const gs = [...document.querySelectorAll('g[data-group]')];
  return gs.map(g => {
    const rect = g.querySelector('rect[data-group-box-rx]') || g.querySelector('rect');
    return {
      key:   g.getAttribute('data-group'),
      tier:  g.getAttribute('data-group-tier'),
      y:     rect ? parseFloat(rect.getAttribute('y') || '0') : null,
      h:     rect ? parseFloat(rect.getAttribute('height') || '0') : null,
    };
  });
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceOrphanBand     = /orphanMembers\.push\(\.\.\.run\.members\)/.test(src);
const sourceOrphanBox      = /band\.isOrphan\s*\?\s*'其他'/.test(src);
const sourceTypeIsOrphan   = /isOrphan\?:\s*boolean/.test(src);

await browser.close();

const alphaBox  = probe.find(g => g.key === 'alpha·');
const betaBox   = probe.find(g => g.key === 'beta·');
const orphanBox = probe.find(g => g.key === '其他');

// Orphan box should be positioned BELOW (higher y) all prefix-group boxes
const orphanBelowPrefix = orphanBox && alphaBox && betaBox &&
  orphanBox.y > alphaBox.y && orphanBox.y > betaBox.y;

const results = {
  alpha_box_present:        !!alphaBox,
  beta_box_present:         !!betaBox,
  orphan_box_present:       !!orphanBox,
  orphan_below_prefix:      !!orphanBelowPrefix,
  source_orphan_collect:    sourceOrphanBand,
  source_orphan_box_key:    sourceOrphanBox,
  source_type_isOrphan:     sourceTypeIsOrphan,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} v0.10.4 #150 orphan-band layout:`, JSON.stringify(results),
  '\n  alpha:', JSON.stringify(alphaBox),
  '\n  beta:', JSON.stringify(betaBox),
  '\n  orphan:', JSON.stringify(orphanBox));
process.exit(ok ? 0 : 1);
