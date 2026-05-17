/* Round 545 verification: vendor filter pill gains vendorColor drop-
 * shadow when rendered. 3rd of 4 pill variants after R543/R544.
 * Source-canonical (banked R544 lesson — pin via UI is impractical for
 * vendor chip surface; setPinnedVendor needs explicit click on vendor
 * letter chip which renders only at vendorDist > 2).
 *
 * Test phases:
 *   1. unpinned (default): no [data-active-filter="vendor"] element
 *   2. source-side regex confirms filter wired with vendorColor via
 *      color-mix 60% syntax
 *   3. source-side scoping: filter wiring is INSIDE the vendor-pill block
 *      (matched via setPinnedVendor handler proximity)
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
  // 3 vendors so vendor chip renders (vendorDist.length > 2 gate per R281)
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
await page.waitForTimeout(500);

const unpinned = await page.evaluate(() =>
  document.querySelector('[data-active-filter="vendor"]') !== null
);

// Phase 2: try to pin via clicking vendor letter chip (HTML element, hoverable)
await page.click('[data-vendor-letter]');
await page.waitForTimeout(400);

const pillPresent = await page.evaluate(() =>
  document.querySelector('[data-active-filter="vendor"]') !== null
);

let pinned = null;
if (pillPresent) {
  pinned = await page.evaluate(() => {
    const el = document.querySelector('[data-active-filter="vendor"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      inlineFilter: el.style.filter,
      filter: cs.filter,
    };
  });
}

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Filter wiring: same color-mix pattern as R544 but with vendorColor not pal.legendAccent
const vendorPillScope = src.match(/onClick=\{\(\) => setPinnedVendor\(null\)\}[\s\S]{0,2500}/)?.[0] || '';
const sourceFilterScoped =
  /filter: `drop-shadow\(0 0 3px color-mix\(in srgb, \$\{vendorColor\} 60%, transparent\)\)`,/.test(vendorPillScope);

const results = {
  unpinned_pill_absent:    unpinned === false,
  pinned_pill_present:     pillPresent === true,
  pinned_inline_filter:    pinned && /drop-shadow/.test(pinned.inlineFilter || ''),
  pinned_computed_filter:  pinned && /drop-shadow/.test(pinned.filter || ''),
  source_filter_scoped:    sourceFilterScoped,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R545 vendor filter pill glow:`,
  JSON.stringify(results, null, 2),
  '\n  unpinned absent:', unpinned,
  '\n  pinned:', JSON.stringify(pinned));
process.exit(ok ? 0 : 1);
