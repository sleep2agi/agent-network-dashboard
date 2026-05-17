/* Round 492 verification: chrome-strip Ring/Grid buttons gain
 * `active:scale-95` press feedback alongside R196's `active:bg-cyan-
 * 500/25` color-deepen. Adds haptic-like compression on click,
 * synced with bg/color via inline `transform 150ms ease-out`.
 *
 * Verifies (per Ring + Grid button):
 *  1. button DOM element present
 *  2. className contains 'active:scale-95' and 'transform-gpu'
 *  3. inline style transition string includes 'transform 150ms ease-out'
 *  4. baseline transform resolves to none/matrix-identity (not pressed)
 *  5. source-file regex confirms both buttons wired
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1', 'working')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForTimeout(800);

const probe = async (selector) => {
  const el = await page.$(selector);
  if (!el) return null;
  const data = await page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      className: el.className || '',
      transition_property:    cs.transitionProperty,
      transition_duration:    cs.transitionDuration,
      transition_timing_func: cs.transitionTimingFunction,
      transform_baseline:     cs.transform,
    };
  }, selector);
  return data;
};

const ringInfo = await probe('[data-topo-chrome-layout="ring"]');
const gridInfo = await probe('[data-topo-chrome-layout="grid"]');

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRingActive = /data-topo-chrome-layout="ring"[\s\S]{0,8000}active:scale-95 transform-gpu/.test(src);
const sourceGridActive = /data-topo-chrome-layout="grid"[\s\S]{0,8000}active:scale-95 transform-gpu/.test(src);
const sourceRingTransform = /background-color 150ms ease, color 150ms ease, letter-spacing 200ms ease-out, transform 150ms ease-out/.test(src);
const sourceGridTransform = /border-color 200ms ease-out, letter-spacing 200ms ease-out, transform 150ms ease-out/.test(src);

const hasActiveScale = (cls) => /active:scale-95/.test(cls) && /transform-gpu/.test(cls);
const hasTransformInTransition = (info) =>
  info && /transform/i.test(info.transition_property || '') && /\b0\.15s\b/.test(info.transition_duration || '');
const isBaselineIdentity = (info) =>
  info && (info.transform_baseline === 'none' || info.transform_baseline === 'matrix(1, 0, 0, 1, 0, 0)');

const results = {
  ring_dom_found:      !!ringInfo,
  ring_class_active:   ringInfo && hasActiveScale(ringInfo.className),
  ring_transform_tr:   hasTransformInTransition(ringInfo),
  ring_baseline_id:    isBaselineIdentity(ringInfo),
  grid_dom_found:      !!gridInfo,
  grid_class_active:   gridInfo && hasActiveScale(gridInfo.className),
  grid_transform_tr:   hasTransformInTransition(gridInfo),
  grid_baseline_id:    isBaselineIdentity(gridInfo),
  source_ring_active:  sourceRingActive,
  source_grid_active:  sourceGridActive,
  source_ring_tr:      sourceRingTransform,
  source_grid_tr:      sourceGridTransform,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome-strip Ring/Grid active:scale-95 (R492):`, JSON.stringify(results),
  '\n  ring:', ringInfo && { tp: ringInfo.transition_property, td: ringInfo.transition_duration, tx: ringInfo.transform_baseline },
  '\n  grid:', gridInfo && { tp: gridInfo.transition_property, td: gridInfo.transition_duration, tx: gridInfo.transform_baseline });
process.exit(ok ? 0 : 1);
