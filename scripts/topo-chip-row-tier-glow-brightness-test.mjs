/* Round 578 verification: chip-row tier-color glow trio gains
 * stacked brightness:
 *   R537 legend swatch  + R578 brightness(1.15)
 *   R541 vendor chip    + R578 brightness(1.15)
 *   R542 pressure-seg     (already had brightness(1.2) — pre-existing)
 *
 * Test phases:
 *   1. rest: legend swatch filter='none', brightness-attr='1'
 *   2. source: legend swatch stacked filter expression
 *   3. source: vendor chip stacked filter expression (pin + hover branches)
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
    mk('alpha·1', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-swatch="working"]', { timeout: 15000 });
await page.waitForTimeout(500);

const restSwatch = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-swatch="working"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    brightnessAttr: el.getAttribute('data-legend-swatch-brightness'),
    glowAttr: el.getAttribute('data-legend-swatch-glow'),
  };
});

// Click pressure-seg working → pinnedStatus='working' → legend swatch lifts
await page.click('[data-pressure-seg="working"]');
await page.waitForTimeout(400);
const pinnedSwatch = await page.evaluate(() => {
  const el = document.querySelector('[data-legend-swatch="working"]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    brightnessAttr: el.getAttribute('data-legend-swatch-brightness'),
    glowAttr: el.getAttribute('data-legend-swatch-glow'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceSwatchFilter = /filter: isSwatchLifted\s*\?\s*`drop-shadow\(0 0 3px \$\{row\.fill\}99\) brightness\(1\.15\)`/.test(src);
const sourceSwatchAttr = /data-legend-swatch-brightness=\{isSwatchLifted \? '1\.15' : '1'\}/.test(src);
const sourceVendorPin = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 60%, transparent\)\) brightness\(1\.15\)`/.test(src);
const sourceVendorHover = /`drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 40%, transparent\)\) brightness\(1\.15\)`/.test(src);

const results = {
  rest_swatch_filter_none:    restSwatch?.filter === 'none',
  rest_swatch_brightness_1:   restSwatch?.brightnessAttr === '1',
  rest_swatch_glow_false:     restSwatch?.glowAttr === 'false',
  pinned_swatch_brightness_1_15: pinnedSwatch?.brightnessAttr === '1.15',
  pinned_swatch_glow_true:    pinnedSwatch?.glowAttr === 'true',
  pinned_swatch_has_dropshadow: /drop-shadow\(/.test(pinnedSwatch?.filter || ''),
  pinned_swatch_has_brightness: /brightness\(1\.15\)/.test(pinnedSwatch?.filter || ''),
  source_swatch_filter:       sourceSwatchFilter,
  source_swatch_attr:         sourceSwatchAttr,
  source_vendor_pin_filter:   sourceVendorPin,
  source_vendor_hover_filter: sourceVendorHover,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R578 chip-row tier-color glow trio stacked brightness (legend swatch + vendor chip):`,
  JSON.stringify(results, null, 2),
  '\n  rest swatch:', JSON.stringify(restSwatch),
  '\n  pinned swatch:', JSON.stringify(pinnedSwatch));
process.exit(ok ? 0 : 1);
