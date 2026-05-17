/* Round 551 verification: orphan band ("其他") rest-state LABEL opacity
 * drops 0.55 → 0.4. 4th channel in the category-differentiation family
 * (R499 italic, R503 dash, R506 rect fill, R551 label paint).
 *
 * Needs an orphan group to exist. The cluster-by-prefix logic creates
 * an orphan band whenever there are sessions without a recognizable
 * prefix (alias with no separator). Mock with a mix: 6 sessions with
 * "alpha-" prefix (groups together) + 2 sessions with no separator
 * (orphan).
 *
 * Test phases:
 *   1. confirm grid layout active
 *   2. locate orphan group-label vs prefix group-label
 *   3. orphan rest opacity = 0.4, opacity attr surfaces value
 *   4. prefix-group rest opacity = 0.55 (unchanged)
 *   5. source-side regex confirms wiring
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
// Mock: 6 alpha-prefix sessions (prefix group) + 3 standalone (orphan band).
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status = 'idle') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1'), mk('alpha·2'), mk('alpha·3'),
    mk('alpha·4'), mk('alpha·5'), mk('alpha·6'),
    mk('foo'), mk('bar'), mk('baz'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-group-label]', { timeout: 15000 });
await page.waitForTimeout(500);

const groups = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('[data-group-label]'));
  return els.map(el => ({
    key: el.getAttribute('data-group-label'),
    orphan: el.getAttribute('data-group-label-orphan') === 'true',
    opacityAttr: el.getAttribute('data-group-label-opacity'),
    computedOpacity: getComputedStyle(el).opacity,
    pinned: el.getAttribute('data-group-label-pinned') === 'true',
    hovered: el.getAttribute('data-group-label-hovered') === 'true',
  }));
});

await browser.close();

const orphan = groups.find(g => g.orphan);
const prefix = groups.find(g => !g.orphan);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired =
  /opacity=\{isPinned \|\| isHovered \? 1 : box\.isOrphan \? 0\.4 : 0\.55\}/.test(src);
const sourceAttrWired =
  /data-group-label-opacity=\{isPinned \|\| isHovered \? 1 : box\.isOrphan \? 0\.4 : 0\.55\}/.test(src);

const results = {
  orphan_present:           !!orphan,
  prefix_present:           !!prefix,
  orphan_attr_0_4:          orphan?.opacityAttr === '0.4',
  orphan_computed_0_4:      orphan ? Math.abs(parseFloat(orphan.computedOpacity) - 0.4) < 0.001 : false,
  prefix_attr_0_55:         prefix?.opacityAttr === '0.55',
  prefix_computed_0_55:     prefix ? Math.abs(parseFloat(prefix.computedOpacity) - 0.55) < 0.001 : false,
  orphan_rest_state:        orphan ? !orphan.pinned && !orphan.hovered : false,
  prefix_rest_state:        prefix ? !prefix.pinned && !prefix.hovered : false,
  source_wired:             sourceWired,
  source_attr_wired:        sourceAttrWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R551 orphan label opacity 0.55→0.4 (category-differentiation 4th channel):`,
  JSON.stringify(results, null, 2),
  '\n  orphan:', JSON.stringify(orphan),
  '\n  prefix:', JSON.stringify(prefix),
  '\n  all groups:', JSON.stringify(groups, null, 2));
process.exit(ok ? 0 : 1);
