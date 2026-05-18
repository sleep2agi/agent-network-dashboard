/* Round 690 — extends vendor letter glyph (R676) + count suffix (R688)
 * halo gates from hover-only to (hover || pin). When a vendor is
 * pinned, all 3 nested layers (outer chip rect R663 + inner letter +
 * count) glow persistently in the brand hue. Closes vendor chip
 * pin-gesture symmetry — sibling to R689 (working/online chip pin-
 * gated halo).
 *
 * Source assertions:
 *   - vendor letter glyph filter gate: (hoveredVendor || isPinned)
 *   - count suffix filter gate:        (hoveredVendor || isPinned)
 *   - halo-layers attrs reflect extended gate logic
 *
 * Runtime assertions:
 *   - vendor letter glyphs + suffixes render (multiple vendors)
 *   - rest halo-layers='0' on both (no hover, no pin)
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'claude-opus-4'),
    mk('a·2', 'gpt-4o'),
    mk('a·3', 'gemini-pro'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-vendor-letter-glyph]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const glyphs = Array.from(document.querySelectorAll('[data-vendor-letter-glyph]'));
  const suffixes = Array.from(document.querySelectorAll('[data-vendor-letter-count-suffix]'));
  return {
    glyphs_count:   glyphs.length,
    suffixes_count: suffixes.length,
    rest_glyph_layers_all_zero:   glyphs.every(el => el.getAttribute('data-vendor-letter-glyph-halo-layers') === '0'),
    rest_suffix_layers_all_zero:  suffixes.every(el => el.getAttribute('data-vendor-letter-count-suffix-halo-layers') === '0'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlyphGate  = /data-vendor-letter-glyph-halo-layers=\{\(hoveredVendor === v\.initial \|\| isPinned\) \? '2' : '0'\}/.test(src);
const sourceSuffixGate = /data-vendor-letter-count-suffix-halo-layers=\{\(hoveredVendor === v\.initial \|\| isPinned\) \? '2' : '0'\}/.test(src);
const sourceGlyphFilter  = /filter: \(hoveredVendor === v\.initial \|\| isPinned\) \? `drop-shadow\(0 0 2px \$\{v\.color\}80\) drop-shadow\(0 0 4px \$\{v\.color\}40\) brightness\(1\.15\)`/.test(src);
const sourceSuffixFilter = /filter: \(hoveredVendor === v\.initial \|\| isPinned\)\s*\?\s*`drop-shadow\(0 0 2px \$\{v\.color\}80\) drop-shadow\(0 0 4px \$\{v\.color\}40\)`/.test(src);

const results = {
  glyphs_present:     runtimeState.glyphs_count >= 2,
  suffixes_present:   runtimeState.suffixes_count >= 2,
  rest_glyph_zero:    runtimeState.rest_glyph_layers_all_zero,
  rest_suffix_zero:   runtimeState.rest_suffix_layers_all_zero,
  source_glyph_gate:  sourceGlyphGate,
  source_suffix_gate: sourceSuffixGate,
  source_glyph_filter:  sourceGlyphFilter,
  source_suffix_filter: sourceSuffixFilter,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R690 vendor letter glyph + count suffix pin-gated halo:`,
  JSON.stringify(results, null, 2),
  `\n  runtime: glyphs=${runtimeState.glyphs_count}, suffixes=${runtimeState.suffixes_count}`);
process.exit(ok ? 0 : 1);
