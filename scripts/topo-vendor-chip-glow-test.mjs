/* Round 541 verification: vendor letter chip gains drop-shadow glow on
 * hover/pin using its own vendor.color identity. 2-tier alpha ladder
 * (pin 99 / hover 66). Sibling to R537 legend-swatch tier-color glow.
 *
 * Test phases (multi-vendor setup so vendor chips render):
 *   1. rest: data-vendor-glow='false', filter='none'
 *   2. hover vendor chip: glow='hover', filter has drop-shadow with
 *      vendor color at lower alpha
 *   3. source-side regex confirms filter ternary + 3-value attr
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
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // R281 gates vendor chip render on vendorDist.length > 2 — need 3+
  // distinct vendor types. Anthropic claude / Google gemini / OpenAI gpt.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'claude-opus-4'),
    mk('a·2', 'gemini-2.5-pro'),
    mk('a·3', 'gpt-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-vendor-letter]', { timeout: 15000 });
await page.waitForTimeout(800);

// Pick the first vendor chip — probe both computed (CSS resolved) AND
// inline (React-set raw style) for filter, since !important class rules
// can override computed even if inline is set.
const restRead = async () => page.evaluate(() => {
  const el = document.querySelector('[data-vendor-letter]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    glow:        el.getAttribute('data-vendor-glow'),
    initial:     el.getAttribute('data-vendor-letter'),
    filter:      cs.filter,
    inlineFilter: el.style.filter,
  };
});

// Phase 1: rest
const rest = await restRead();

// Phase 2: hover the chip
await page.hover('[data-vendor-letter]');
await page.waitForTimeout(400);
const hover = await restRead();

await browser.close();

// Source regex — uses color-mix() instead of hex+alpha since v.color is
// HSL format (vendorIdentity mono.text), not hex. Banked test-craft note.
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilterTernary =
  /filter: isPinned\s+\? `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 60%, transparent\)\)`\s+: hoveredVendor === v\.initial\s+\? `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{v\.color\} 40%, transparent\)\)`\s+: undefined,/.test(src);
const sourceAttrTernary =
  /data-vendor-glow=\{isPinned \? 'pin' : hoveredVendor === v\.initial \? 'hover' : 'false'\}/.test(src);

const results = {
  rest_glow_false:         rest?.glow === 'false',
  rest_filter_none:        rest?.filter === 'none' || rest?.filter === '',
  hover_glow_hover:        hover?.glow === 'hover',
  hover_filter_drop_shadow: /drop-shadow/.test(hover?.filter || ''),
  source_filter_ternary:   sourceFilterTernary,
  source_attr_ternary:     sourceAttrTernary,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R541 vendor-chip glow:`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
