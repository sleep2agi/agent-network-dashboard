/* Round 607 — legend pin-ring stacks brightness(1.15) onto
 * R477's pin-gated drop-shadow. Pin-gated brightness family
 * extends to 3rd anchor (R571 group label + R587 group box +
 * R607 legend pin-ring).
 *
 * Test phases:
 *   1. mock 2 nodes → legend rows render
 *   2. rest: pin-ring opacity=0 (no pin), filter='none',
 *      brightness-attr='1'
 *   3. computed transition-property contains 'filter'
 *   4. source: stacked filter conditional + data-attr
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
await page.waitForSelector('[data-legend-pin-ring-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-pin-ring-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    opacity: cs.opacity,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-legend-pin-ring-brightness'),
    glowAttr: el.getAttribute('data-legend-pin-ring-glow'),
    pinnedAttr: el.getAttribute('data-legend-pin-ring-pinned'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: isPinned\s*\?\s*`drop-shadow\(0 0 3px \$\{row\.fill\}88\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-legend-pin-ring-brightness=\{isPinned \? '1\.15' : '1'\}/.test(src);

const results = {
  pin_ring_present:       !!rest,
  rest_filter_none:       rest?.filter === 'none',
  rest_opacity_zero:      parseFloat(rest?.opacity || '1') === 0,
  rest_brightness_1:      rest?.brightnessAttr === '1',
  rest_glow_false:        rest?.glowAttr === 'false',
  rest_pinned_false:      rest?.pinnedAttr === 'false',
  transition_has_filter:  /filter/.test(rest?.transitionProperty || ''),
  source_filter:          sourceFilter,
  source_attr:            sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R607 legend pin-ring brightness (pin-gated family 3rd anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`);
process.exit(ok ? 0 : 1);
