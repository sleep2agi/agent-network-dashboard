/* Round 608 — click-ripple gains drop-shadow glow that matches
 * the ripple's stroke color. Expanding feedback ring now reads
 * as a "lit pulse" rather than a plain stroke line.
 *
 * Test phases:
 *   1. mock 2 idle nodes → click first node → ripple renders
 *   2. ripple element present with data-click-ripple attr
 *   3. computed filter contains 'drop-shadow'
 *   4. data-click-ripple-glow attr present with valid format
 *   5. source: filter inline + data-attr extension
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
// Click hub group (role=button aria-label="Network hub...") to fire setClickRipple
await page.waitForSelector('[data-topo-hub-fade-delay]', { timeout: 15000, state: 'attached' });
const hubBox = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-fade-delay]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (!hubBox) throw new Error('hub not found');
await page.mouse.click(hubBox.x, hubBox.y);
// Wait briefly so the ripple mounts but doesn't fully fade
await page.waitForSelector('[data-click-ripple]', { timeout: 5000, state: 'attached' });
await page.waitForTimeout(100);

const rippleState = await page.evaluate(() => {
  const el = document.querySelector('[data-click-ripple]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    filter: cs.filter,
    glowAttr: el.getAttribute('data-click-ripple-glow'),
    stroke: el.getAttribute('stroke'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: `drop-shadow\(0 0 4px \$\{clickRipple\.color\}99\)`/.test(src);
const sourceAttr = /data-click-ripple-glow=\{`0 0 4px \$\{clickRipple\.color\}99`\}/.test(src);

const results = {
  ripple_present:        !!rippleState,
  has_drop_shadow:       /drop-shadow/.test(rippleState?.filter || ''),
  glow_attr_format:      /^0 0 4px /.test(rippleState?.glowAttr || ''),
  has_stroke:            !!rippleState?.stroke,
  source_filter:         sourceFilter,
  source_attr:           sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R608 click-ripple drop-shadow glow (click feedback enhancement):`,
  JSON.stringify(results, null, 2),
  `\n  ripple: ${JSON.stringify(rippleState)}`);
process.exit(ok ? 0 : 1);
