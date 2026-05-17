/* Round 507 verification: hub-center workingCount digit fades to
 * opacity 0.85 when ANY non-hub canvas surface is hovered. Lifts back
 * to 1.0 on un-hover or when hovering the hub itself.
 *
 * Test phases:
 *   1. rest (no hover) — opacity 1, data-topo-hub-recede='false'
 *   2. node hover (synthetic pointerenter on g[data-node]) —
 *      opacity 0.85, data-topo-hub-recede='true'
 *   3. release hover — back to opacity 1, recede='false'
 *
 * Source-side regex confirms gate + style + attr wired.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·a1', 'working'),
    mk('alpha·a2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-working-count-glow]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Phase 1: rest state
const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count-glow]');
  if (!el) return null;
  return {
    recede_attr: el.getAttribute('data-topo-hub-recede'),
    opacity: window.getComputedStyle(el).opacity,
  };
});

// Phase 2: hover a node via R488 banked synthetic dispatch
await page.evaluate(() => {
  const g = document.querySelector('g[data-node]');
  if (!g) return;
  const target = g.querySelector('circle, image, rect') || g;
  ['pointerenter', 'pointerover', 'mouseenter', 'mouseover'].forEach((t) => {
    target.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }));
  });
});
await page.waitForTimeout(500);
const hover = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count-glow]');
  if (!el) return null;
  return {
    recede_attr: el.getAttribute('data-topo-hub-recede'),
    opacity: window.getComputedStyle(el).opacity,
  };
});

// Phase 3: release hover
await page.evaluate(() => {
  const g = document.querySelector('g[data-node]');
  if (!g) return;
  const target = g.querySelector('circle, image, rect') || g;
  ['pointerleave', 'pointerout', 'mouseleave', 'mouseout'].forEach((t) => {
    target.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }));
  });
});
await page.waitForTimeout(500);
const release = await page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-working-count-glow]');
  if (!el) return null;
  return {
    recede_attr: el.getAttribute('data-topo-hub-recede'),
    opacity: window.getComputedStyle(el).opacity,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGateWired = /\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel \|\|\s*hoveredStatus \|\| hoveredVendor\) && !hoveredHub/.test(src);
const sourceOpacity = /opacity: \(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel/.test(src);
const sourceAttr = /data-topo-hub-recede=\{/.test(src);

// computed opacity comes back as a number-string ('1', '0.85')
const approxEq = (a, b) => Math.abs(parseFloat(a) - b) < 0.01;

const results = {
  rest_recede_false:    rest && rest.recede_attr === 'false',
  rest_opacity_1:       rest && approxEq(rest.opacity, 1),
  hover_recede_true:    hover && hover.recede_attr === 'true',
  hover_opacity_85:     hover && approxEq(hover.opacity, 0.85),
  release_recede_false: release && release.recede_attr === 'false',
  release_opacity_1:    release && approxEq(release.opacity, 1),
  source_gate_wired:    sourceGateWired,
  source_opacity_wired: sourceOpacity,
  source_attr_wired:    sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R507 hub-recede:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  release:', JSON.stringify(release));
process.exit(ok ? 0 : 1);
