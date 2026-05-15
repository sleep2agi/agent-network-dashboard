/* Round 156 verification: SVG <g> interactives gain
 * `.anet-topo-svg-focus` for keyboard focus outline.
 *
 * Mirrors R155's chip-row treatment at the SVG scope. 6 surfaces:
 *   data-node                       (R151 node body)
 *   data-group-label-hit            (R63 group label)
 *   data-edge-count-badge           (R121 edge badge)
 *   data-recent-row                 (R116 recent-signal row)
 *   data-recent-panel-more-nav      (R133 "+N more" footer)
 *   data-legend-status              (R61 legend row)
 *
 * Class `.anet-topo-svg-focus:focus-visible` paints outline 2px
 * cyan-300 (#67e8f9) with 2px outline-offset. Browser default
 * focus ring on SVG is hard to spot against the dashboard
 * canvas; explicit cyan matches the legendAccent palette.
 *
 * Test: every SVG interactive surface carries the class.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1600, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // grid layout to surface group labels
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('agents-a1', 'working'), mk('agents-a2', 'working'),
    mk('infra-b1',  'working'),
  ] } });
});

const now = Date.now();
// Edge midpoint count badge (R100) only renders when link.count >= 3.
// Pair agents-a1 → agents-a2 gets 4 msgs to clear the threshold; add 4
// other singletons so flowLinks.length = 5 → R128 "+ 2 more flows"
// footer also renders.
const msgs = [];
for (let i = 0; i < 4; i++) {
  msgs.push({
    id: `a2a${i}`, from_alias: 'agents-a1', to_alias: 'agents-a2', content: 'hi',
    network_id: 'default', created_at: new Date(now - (10000 + i * 500)).toISOString(),
  });
}
msgs.push({ id: 'm1', from_alias: 'agents-a2', to_alias: 'infra-b1', content: 'hi',
  network_id: 'default', created_at: new Date(now - 11000).toISOString() });
msgs.push({ id: 'm2', from_alias: 'infra-b1', to_alias: 'agents-a1', content: 'hi',
  network_id: 'default', created_at: new Date(now - 12000).toISOString() });
msgs.push({ id: 'm3', from_alias: 'agents-a1', to_alias: 'infra-b1', content: 'hi',
  network_id: 'default', created_at: new Date(now - 13000).toISOString() });
msgs.push({ id: 'm4', from_alias: 'agents-a2', to_alias: 'agents-a1', content: 'hi',
  network_id: 'default', created_at: new Date(now - 14000).toISOString() });
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-recent-row]', { timeout: 10000 });
await page.waitForSelector('[data-recent-panel-more-nav]', { timeout: 10000 });
await page.waitForSelector('[data-edge-count-badge]', { timeout: 10000 });
await page.waitForSelector('[data-group-label-hit]', { timeout: 10000 });
await page.waitForTimeout(400);

const out = await page.evaluate(() => {
  const has = (sel) => {
    const el = document.querySelector(sel);
    return el && (el.getAttribute('class') || '').includes('anet-topo-svg-focus');
  };
  return {
    nodeBody:           has('g[data-node]'),
    groupLabel:         has('[data-group-label-hit]'),
    edgeCountBadge:     has('[data-edge-count-badge]'),
    recentRow:          has('[data-recent-row]'),
    recentPanelMoreNav: has('[data-recent-panel-more-nav]'),
    legendStatusRow:    has('[data-legend-status="working"]'),
  };
});

await browser.close();

const results = {
  nodeBody_focus:           out.nodeBody === true,
  groupLabel_focus:         out.groupLabel === true,
  edgeCountBadge_focus:     out.edgeCountBadge === true,
  recentRow_focus:          out.recentRow === true,
  recentPanelMoreNav_focus: out.recentPanelMoreNav === true,
  legendStatusRow_focus:    out.legendStatusRow === true,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} SVG focus class:`, JSON.stringify(results),
  `\n  raw=`, out);
process.exit(ok ? 0 : 1);
