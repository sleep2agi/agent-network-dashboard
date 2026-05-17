/* Round 641 — chat-target ring 3-axis breath SMIL animates gain
 * canonical CSS ease-in-out keySplines (0.42 0 0.58 1, twice for
 * both halves). All three animates (opacity, stroke-width, r)
 * share the same curve so the breath settles at endpoints
 * and accelerates through midpoints — heart-rest organic feel.
 *
 * Test phases:
 *   1. mock 2 idle nodes, no chat → ring at rest, breath-curve='none'
 *   2. click a·1 → 3 animates concurrently with:
 *      - calcMode='spline'
 *      - keyTimes='0;0.5;1'
 *      - keySplines='0.42 0 0.58 1;0.42 0 0.58 1'
 *   3. breath-curve attr === 'ease-in-out'
 *   4. source: all 3 animates carry the new attrs
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
await page.waitForSelector('[data-chat-target-ring]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-chat-target-ring]');
  if (!el) return null;
  return {
    curve: el.getAttribute('data-chat-target-ring-breath-curve'),
    active: el.getAttribute('data-chat-target-active'),
  };
});

await page.click('[data-node="a·1"]', { force: true });
await page.waitForTimeout(400);

const active = await page.evaluate(() => {
  const node = document.querySelector('[data-node="a·1"]');
  if (!node) return null;
  const ring = node.querySelector('[data-chat-target-ring]');
  if (!ring) return null;
  const animates = Array.from(ring.querySelectorAll('animate'));
  return {
    curve: ring.getAttribute('data-chat-target-ring-breath-curve'),
    active: ring.getAttribute('data-chat-target-active'),
    animateAttrs: animates.map(a => ({
      attr: a.getAttribute('attributeName'),
      calc: a.getAttribute('calcMode'),
      kt:   a.getAttribute('keyTimes'),
      ks:   a.getAttribute('keySplines'),
    })),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Each of the 3 animates should carry the same spline attrs
const splineAttrPattern = /calcMode="spline"\s+keyTimes="0;0\.5;1"\s+keySplines="0\.42 0 0\.58 1;0\.42 0 0\.58 1"/g;
const splineMatches = (src.match(splineAttrPattern) || []).length;
const sourceCurveAttr = /data-chat-target-ring-breath-curve=\{!reducedMotion && isChat \? 'ease-in-out' : 'none'\}/.test(src);

const allHaveSpline = active?.animateAttrs?.length === 3 && active.animateAttrs.every(a =>
  a.calc === 'spline' &&
  a.kt === '0;0.5;1' &&
  a.ks === '0.42 0 0.58 1;0.42 0 0.58 1'
);

const results = {
  rest_curve_none:        rest?.curve === 'none',
  active_curve_ease:      active?.curve === 'ease-in-out',
  active_animate_count_3: active?.animateAttrs?.length === 3,
  active_all_have_spline: allHaveSpline,
  active_has_opacity:     active?.animateAttrs?.some(a => a.attr === 'opacity'),
  active_has_sw:          active?.animateAttrs?.some(a => a.attr === 'stroke-width'),
  active_has_r:           active?.animateAttrs?.some(a => a.attr === 'r'),
  // Multiple SMIL ease-in-out splines exist across the file (R243 active-
  // pulse, R244 hub-halo, plus 3 new chat-target ring animates). Assert
  // count >= 3 — runtime block already verifies the 3 chat-target ring
  // animates carry the exact attrs.
  source_at_least_3_splines: splineMatches >= 3,
  source_curve_attr:      sourceCurveAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R641 chat-target ring 3-axis breath ease-in-out keySplines:`,
  JSON.stringify(results, null, 2),
  `\n  rest:   ${JSON.stringify(rest)}`,
  `\n  active: ${JSON.stringify(active)}`);
process.exit(ok ? 0 : 1);
