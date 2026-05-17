/* Round 606 — recent-row freshness pip stacks brightness(1.15)
 * onto R478 freshness-gated drop-shadow. Same alpha > 0.7 gate
 * so both filter effects activate together for fresh signals.
 *
 * Test phases:
 *   1. mock 1 fresh message (~10s old, alpha > 0.7) → pip renders
 *      with glow + brightness filter
 *   2. computed filter contains BOTH drop-shadow AND brightness
 *   3. brightness-attr = '1.15' on fresh signal
 *   4. source: stacked filter conditional + data-attr
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
// 10 seconds ago → freshness alpha ≈ 1.0 (well above 0.7 gate)
const fresh = new Date(Date.now() - 10 * 1000).toISOString();

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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'fresh hi', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-freshness-brightness]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const fresh_state = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-freshness-brightness]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    transitionProperty: cs.transitionProperty,
    brightnessAttr: el.getAttribute('data-recent-row-freshness-brightness'),
    glowAttr: el.getAttribute('data-recent-row-freshness-glow'),
    alphaAttr: el.getAttribute('data-recent-row-freshness-alpha'),
    opacity: cs.opacity,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: alpha > 0\.7\s*\?\s*`drop-shadow\(0 0 3px \$\{pal\.legendAccent\}80\) brightness\(1\.15\)`\s*:\s*undefined/.test(src);
const sourceAttr = /data-recent-row-freshness-brightness=\{alpha > 0\.7 \? '1\.15' : '1'\}/.test(src);

const results = {
  pip_present:               !!fresh_state,
  // Fresh signal: alpha ≈ 1.0 > 0.7 → both drop-shadow AND brightness in filter
  fresh_filter_has_drop_shadow: /drop-shadow/.test(fresh_state?.filter || ''),
  fresh_filter_has_brightness:  /brightness/.test(fresh_state?.filter || ''),
  fresh_brightness_115:         fresh_state?.brightnessAttr === '1.15',
  fresh_glow_true:              fresh_state?.glowAttr === 'true',
  fresh_alpha_above_0_7:        parseFloat(fresh_state?.alphaAttr || '0') > 0.7,
  transition_has_filter:        /filter/.test(fresh_state?.transitionProperty || ''),
  source_filter:                sourceFilter,
  source_attr:                  sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R606 freshness-pip stacked brightness (freshness-gated 4-axis):`,
  JSON.stringify(results, null, 2),
  `\n  fresh: ${JSON.stringify(fresh_state)}`);
process.exit(ok ? 0 : 1);
