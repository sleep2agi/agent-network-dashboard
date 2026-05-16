/* Round 262 verification: corner-radius vocabulary unified across the
 * canvas chrome — panels drop rx="10" → rx="8" to match the wrapper's
 * rounded-lg (8px).
 *
 * Pre-R262 corner-radius hierarchy:
 *   Group label rect:    rx="4"   ← tiny chip
 *   Node label card:     rx="6"   ← small card
 *   Recent-signal panel: rx="10"  ← panel chrome   ← MISMATCHED
 *   Legend panel:        rx="10"  ← panel chrome   ← MISMATCHED
 *   Canvas wrapper:      rounded-lg (8 px CSS)
 *   ⇒ Panels at 10 px more rounded than the wrapper at 8 px.
 *
 * Post-R262:
 *   Group label:    rx=4
 *   Node label card:rx=6
 *   Panels:         rx=8   ← matches wrapper
 *   Canvas wrapper: rounded-lg (8 px)
 *   ⇒ Clean 4→6→8 progression. Panel corners now flush with wrapper
 *      corners, not exceeding them.
 *
 * Test scope:
 *   1. Recent-signal panel rect rx === "8".
 *   2. Legend panel rect rx === "8".
 *   3. Node label card rect rx === "6" (unchanged regression).
 *   4. Group label rect rx === "4" (unchanged regression).
 *   5. Canvas wrapper computed border-top-left-radius === 8 px.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    // Grid layout exposes the group label rect (rx=4)
    localStorage.setItem('anet-topo-layout', 'grid');
  } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Use a group prefix so the prefix-group boundary box renders + its
  // group label rect with rx=4 is in the DOM for regression check.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha-1'), mk('alpha-2'), mk('alpha-3'), mk('alpha-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-panel="recent"]',  { timeout: 10000 });
await page.waitForSelector('[data-topo-panel="legend"]',  { timeout: 10000 });
await page.waitForSelector('[data-node-label-card]',      { timeout: 10000 });
await page.waitForSelector('[data-group-label-tinted]',   { timeout: 10000 });
await page.waitForSelector('[data-topo-wrapper]',         { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const recentG = document.querySelector('[data-topo-panel="recent"]');
  const legendG = document.querySelector('[data-topo-panel="legend"]');
  const recentRx = recentG?.querySelector('rect')?.getAttribute('rx');
  const legendRx = legendG?.querySelector('rect')?.getAttribute('rx');
  // Node label card rect — query any one of them
  const cardRect = document.querySelector('[data-node-label-card]');
  const cardRx   = cardRect?.getAttribute('rx');
  // Group label rect — the bg tint rect inside the group-label-hit group
  const groupTintRect = document.querySelector('[data-group-label-tinted]');
  const groupTintRx   = groupTintRect?.getAttribute('rx');
  // Wrapper CSS corner radius
  const wrapper = document.querySelector('[data-topo-wrapper]');
  const wrapperBorderRadius = wrapper ? window.getComputedStyle(wrapper).borderTopLeftRadius : null;
  return {
    recentRx, legendRx, cardRx, groupTintRx, wrapperBorderRadius,
  };
});
await browser.close();

const results = {
  recent_panel_rx_8:           probe.recentRx === '8',
  legend_panel_rx_8:           probe.legendRx === '8',
  node_label_card_rx_6:        probe.cardRx === '6',
  group_label_tint_rx_4:       probe.groupTintRx === '4',
  wrapper_border_radius_8px:   probe.wrapperBorderRadius === '8px',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} corner-radius unify:`, JSON.stringify(results),
  '\n  rxs: recent', probe.recentRx, '· legend', probe.legendRx, '· card', probe.cardRx, '· group-tint', probe.groupTintRx,
  '\n  wrapper border-radius:', probe.wrapperBorderRadius);
process.exit(ok ? 0 : 1);
