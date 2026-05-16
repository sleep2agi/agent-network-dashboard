/* Round 294 verification: per-node "working" pulse dot retired.
 *
 * Pre-R294 each working node carried a small SMIL-animated green
 * circle at its top (R24, R214). After R278 (working halo) /
 * R279 (arrival ping + dispatch pulse) / R280 (backdrop spokes)
 * cleared the surrounding per-node animation family, the pulse
 * dot was the last surviving "wiggling per-node decoration".
 * R294 gates its render block with `{false && ...}` per the
 * R276/R278/R279/R280 rollback-friendly retirement pattern.
 *
 * Working status is preserved via 4 redundant non-animated
 * signals: status ring colour (R167), label sub-text (R211),
 * chip-row count, hub centre digit (R130).
 *
 * Contract:
 *   - Zero [data-pulse-wrapper] elements present on the canvas.
 *   - Working nodes still render (status ring + alias label intact).
 *   - g[data-node] count matches mock session count.
 *   - R290 three radar rings + R291 starfield 14 dots intact.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 4 working sessions — pre-R294 this would mean 4 pulse dots.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
    mk('gamma', 'claude-sonnet-4'),
    mk('delta', 'gpt-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const pulses = document.querySelectorAll('[data-pulse-wrapper]');
  const nodes  = document.querySelectorAll('g[data-node]');
  const aliasTexts = document.querySelectorAll('[data-node-alias-text]');
  const rings = [...document.querySelectorAll('[data-topo-radar-ring]')]
    .map(r => r.getAttribute('data-topo-radar-ring')).sort((a, b) => +a - +b);
  const dots = document.querySelectorAll('[data-topo-starfield-dot]');
  return {
    pulseCount:        pulses.length,
    nodeCount:         nodes.length,
    aliasTextCount:    aliasTexts.length,
    radarRings:        rings,
    starfieldDotCount: dots.length,
  };
});
await browser.close();

const results = {
  pulse_dots_absent:        probe.pulseCount === 0,
  four_nodes_present:       probe.nodeCount === 4,
  alias_labels_still_render: probe.aliasTextCount >= 4,
  r290_three_rings:         JSON.stringify(probe.radarRings) === JSON.stringify(['170', '250', '330']),
  r291_starfield_14:        probe.starfieldDotCount === 14,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pulse dot retired:`, JSON.stringify(results),
  '\n  pulse [data-pulse-wrapper] count (expect 0):', probe.pulseCount,
  '\n  node count:', probe.nodeCount,
  '\n  alias text count:', probe.aliasTextCount);
process.exit(ok ? 0 : 1);
