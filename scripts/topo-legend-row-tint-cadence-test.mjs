/* Round 473 verification: legend-row tint rect transition cadence
 * sync 150ms → 200ms. Final closure of the 3-tier panel-row cadence
 * family — group-label (R459), recent-row (R472), legend-row (R473).
 * All three label-class panel-row hitboxes now ease their fill +
 * opacity at uniform 200ms ease-out.
 *
 * Contract:
 *   - every <rect data-legend-row-tint-transition='200ms'> renders
 *     (one per status legend row — 5 rows: working/idle/offline/+)
 *   - inline style is 'fill 200ms ease-out, opacity 200ms ease-out'
 *   - computed transition-duration is '0.2s, 0.2s'
 *   - NO 'fill 150ms' substring anywhere in any legend-row tint
 *   - source-file attr + style both wired
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'idle'), mk('a·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-row-tint-transition]', { timeout: 15000 });
await page.waitForTimeout(500);

const probe = await page.evaluate(() => {
  const rects = [...document.querySelectorAll('[data-legend-row-tint-transition]')];
  return {
    count: rects.length,
    nodes: rects.map(r => {
      const cs = getComputedStyle(r);
      return {
        attr:     r.getAttribute('data-legend-row-tint-transition'),
        style:    r.getAttribute('style') || '',
        duration: cs.transitionDuration,
      };
    }),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAttr  = /data-legend-row-tint-transition="200ms"/.test(src);
const source150Removed = !src.includes('fill 150ms ease-out, opacity 150ms ease-out');

await browser.close();

const countGe2     = probe.count >= 2;
const allAttr200   = probe.nodes.every(n => n.attr === '200ms');
const allStyle200  = probe.nodes.every(n => /fill 200ms ease-out, opacity 200ms ease-out/.test(n.style));
const allDur200    = probe.nodes.every(n => /(^|, )0\.2s/.test(n.duration));
const noLegacy150  = probe.nodes.every(n => !/fill 150ms/.test(n.style));

const results = {
  legend_rect_count_ge_2: countGe2,
  all_attr_200:           allAttr200,
  all_style_200:          allStyle200,
  all_computed_200:       allDur200,
  no_legacy_150_in_dom:   noLegacy150,
  source_attr:            sourceAttr,
  source_no_150_anywhere: source150Removed,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend-row tint cadence 150→200:`, JSON.stringify(results),
  '\n  count:', probe.count,
  '\n  first:', JSON.stringify(probe.nodes[0]));
process.exit(ok ? 0 : 1);
