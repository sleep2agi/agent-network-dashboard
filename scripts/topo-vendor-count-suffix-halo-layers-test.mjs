/* Round 688 — vendor count suffix `:N` (next to each vendor letter
 * glyph) extends from 2 group-hover axes (opacity + tracking-wide)
 * to also include multi-layer halo paint axis. Uses the SAME per-
 * vendor v.color tint as the inner letter glyph (R676) and the outer
 * chip (R663) — vendor letter chip now 3/3 nested elements glow in
 * the same brand hue under hover. 2+4 stride, alpha 80/40.
 *
 * Source assertions:
 *   - filter uses v.color at 80/40 with 2+4 stride, gated on
 *     hoveredVendor === v.initial
 *   - data-vendor-letter-count-suffix-halo-layers attr toggles '2'/'0'
 *
 * Runtime assertions:
 *   - count suffix spans present (≥2 vendors so multiple ':N' renders)
 *   - rest halo-layers='0' on all
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
    mk('a·4', 'claude-opus-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-vendor-letter-count-suffix]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const restState = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('[data-vendor-letter-count-suffix]')).map(el => ({
    layers: el.getAttribute('data-vendor-letter-count-suffix-halo-layers'),
    text:   el.textContent,
  }));
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: hoveredVendor === v\.initial\s*\?\s*`drop-shadow\(0 0 2px \$\{v\.color\}80\) drop-shadow\(0 0 4px \$\{v\.color\}40\)`\s*: undefined/.test(src);
const sourceAttr   = /data-vendor-letter-count-suffix-halo-layers=\{hoveredVendor === v\.initial \? '2' : '0'\}/.test(src);

const results = {
  suffixes_present:    restState.length >= 2,
  rest_all_layers_0:   restState.every(e => e.layers === '0'),
  source_filter:       sourceFilter,
  source_layers_attr:  sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R688 vendor count suffix multi-layer halo (closes vendor letter chip 3/3):`,
  JSON.stringify(results, null, 2),
  `\n  count: ${restState.length}, sample: ${JSON.stringify(restState.slice(0, 3))}`);
process.exit(ok ? 0 : 1);
