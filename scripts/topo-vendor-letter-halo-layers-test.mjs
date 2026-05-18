/* Round 676 — vendor letter glyph (the per-vendor brand initial in
 * the distribution chip) gains multi-layer halo on hover using its
 * OWN per-vendor color (v.color) as tint. 35th anchor in family —
 * first per-vendor anchor. Sibling to R671 legend-row count's per-
 * tier row.fill pattern.
 *
 * Source assertions:
 *   - filter chain uses v.color at 0x80 + 0x40 with 2+4 stride,
 *     gated on hoveredVendor === v.initial
 *   - transition list extends with 'filter 200ms ease-out'
 *   - data-vendor-letter-glyph-halo-layers attr toggles '2' ↔ '0'
 *
 * Runtime assertions:
 *   - vendor letter glyphs present in chip-row distribution chip
 *   - rest state: halo-layers='0' on all glyphs
 *   - hover gate consistency: hover='true' ↔ halo-layers='2'
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
  // 3 vendors: Claude (claude-opus-4), GPT (gpt-4o), Gemini (gemini-pro)
  // so the vendor distribution chip surfaces multiple letters
  const mk = (alias, model) => ({
    alias, status: 'idle', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'claude-opus-4'),
    mk('a·2', 'gpt-4o'),
    mk('a·3', 'gemini-pro'),
    mk('a·4', 'claude-opus-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-vendor-letter-glyph]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-vendor-letter-glyph]')).map(el => ({
    initial:  el.getAttribute('data-vendor-letter-glyph'),
    hover:    el.getAttribute('data-vendor-letter-glyph-hover'),
    layers:   el.getAttribute('data-vendor-letter-glyph-halo-layers'),
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter      = /filter: hoveredVendor === v\.initial \? `drop-shadow\(0 0 2px \$\{v\.color\}80\) drop-shadow\(0 0 4px \$\{v\.color\}40\) brightness\(1\.15\)` : undefined/.test(src);
const sourceLayersAttr  = /data-vendor-letter-glyph-halo-layers=\{hoveredVendor === v\.initial \? '2' : '0'\}/.test(src);
const sourceTransition  = /transition: 'transform 200ms ease-out, filter 200ms ease-out'/.test(src);

// Gate consistency: hover ↔ layers must agree on every glyph.
const allConsistent = restState.every(e =>
  (e.hover === 'false' && e.layers === '0') ||
  (e.hover === 'true'  && e.layers === '2')
);

const results = {
  glyphs_present:        restState.length >= 2,
  rest_all_layers_zero:  restState.every(e => e.layers === '0'),
  rest_all_hover_false:  restState.every(e => e.hover === 'false'),
  rest_gate_consistent:  allConsistent,
  source_filter:         sourceFilter,
  source_layers_attr:    sourceLayersAttr,
  source_transition:     sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R676 vendor letter glyph multi-layer halo (per-vendor v.color tint):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(restState)}`);
process.exit(ok ? 0 : 1);
