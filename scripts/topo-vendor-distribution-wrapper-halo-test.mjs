/* Round 698 — vendor-distribution chip-row outer wrapper joins the
 * R697 wrapper-level :has() halo family. Pre-R698 only the chrome-strip
 * wrappers (Layout/nodeSize/zoom) echoed inner-button hover at the
 * parent scope. R698 extends to a NEW parent: the vendor-distribution
 * chip-row outer <span>. Inner vendor letter chips are <span role="button">
 * (not real <button>), so the CSS uses :has([role="button"]:hover) — a
 * new selector variant extending R697's vocabulary from real-button
 * children to ARIA-button children.
 *
 * Source assertions:
 *   - globals.css :has([role="button"]:hover) rule on wrapper attr
 *   - globals.css transition rule for the wrapper includes filter
 *   - TopoGraph.tsx outer <span> has data-topo-chrome-vendor-distribution-wrapper
 *
 * Runtime assertions:
 *   - wrapper present when vendorDist.length > 2 (3+ vendors)
 *   - data-attr matches "true"
 *
 * Mock 3 vendors so vendorDist.length > 2 triggers the chip row.
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
  // 3 distinct vendors → vendorDist.length === 3 → chip row renders.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'claude-opus-4'),
    mk('a·2', 'gpt-5'),
    mk('a·3', 'glm-4.6'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-vendor-distribution-wrapper]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const wrapper = document.querySelector('[data-topo-chrome-vendor-distribution-wrapper]');
  if (!wrapper) return null;
  // Count inner role="button" children (the vendor letter chips).
  const innerChips = wrapper.querySelectorAll('[role="button"]');
  return {
    wrapper_present: true,
    wrapper_attr: wrapper.getAttribute('data-topo-chrome-vendor-distribution-wrapper'),
    inner_role_button_count: innerChips.length,
  };
});

await browser.close();

const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');
const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');

const cssHoverRule = /\[data-topo-chrome-vendor-distribution-wrapper\]:has\(\[role="button"\]:hover\)\s*\{[\s\S]*?drop-shadow\(0 0 2px rgba\(103, 232, 249, 0\.5\)\)[\s\S]*?drop-shadow\(0 0 4px rgba\(103, 232, 249, 0\.25\)\)/.test(cssSrc);
const cssTransition = /\[data-topo-chrome-vendor-distribution-wrapper\]\s*\{[\s\S]*?transition:[\s\S]*?filter 200ms/.test(cssSrc);
const tsxWrapperAttr = /data-topo-chrome-vendor-distribution-wrapper="true"/.test(tsxSrc);

const results = {
  wrapper_present:        !!runtimeState?.wrapper_present,
  wrapper_attr_true:      runtimeState?.wrapper_attr === 'true',
  inner_chips_present:    (runtimeState?.inner_role_button_count ?? 0) >= 3,
  css_hover_rule:         cssHoverRule,
  css_transition:         cssTransition,
  tsx_wrapper_attr:       tsxWrapperAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R698 vendor-distribution wrapper :has() multi-layer halo (54th anchor — 2nd wrapper-level :has() anchor):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
