/* Round 508 verification: hub-highlight circle joins the focal-recede
 * pattern (2nd anchor after R507's hub digit). When canvas attention
 * is elsewhere, the hub focal cluster (digit + highlight) recedes as
 * a unit:
 *   - hub-digit opacity: 1 → 0.85 (R507)
 *   - hub-highlight opacity: 0.95 → 0.81 (R508, 0.95 × 0.85)
 *   - hub-highlight SMIL breath: active → halted (R508)
 *
 * Also verifies R497 idle-breath still works in the un-receded state
 * — refactor regression check.
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
  // workingCount === 0 (all idle) so hub-highlight is visible
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·a1', 'idle'),
    mk('alpha·a2', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-hub-highlight]', { timeout: 15000 });
await page.waitForTimeout(1500);

// Phase 1: rest state — idle fleet, no external hover
//   expected: opacity 0.95, breath='true', recede='false', animate present
const rest = await page.evaluate(() => {
  const circle = document.querySelector('[data-topo-hub-highlight]');
  if (!circle) return null;
  return {
    opacity_attr:   circle.getAttribute('data-topo-hub-highlight-opacity'),
    breath_attr:    circle.getAttribute('data-topo-hub-highlight-breath'),
    recede_attr:    circle.getAttribute('data-topo-hub-highlight-recede'),
    has_animate:    !!circle.querySelector('animate[attributeName="opacity"]'),
  };
});

// Phase 2: external hover via R488 synthetic dispatch on a node
//   expected: opacity 0.81 (0.95 * 0.85), breath='false', recede='true',
//             animate ABSENT (halted)
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
  const circle = document.querySelector('[data-topo-hub-highlight]');
  if (!circle) return null;
  return {
    opacity_attr:   circle.getAttribute('data-topo-hub-highlight-opacity'),
    breath_attr:    circle.getAttribute('data-topo-hub-highlight-breath'),
    recede_attr:    circle.getAttribute('data-topo-hub-highlight-recede'),
    has_animate:    !!circle.querySelector('animate[attributeName="opacity"]'),
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
  const circle = document.querySelector('[data-topo-hub-highlight]');
  if (!circle) return null;
  return {
    opacity_attr:   circle.getAttribute('data-topo-hub-highlight-opacity'),
    breath_attr:    circle.getAttribute('data-topo-hub-highlight-breath'),
    recede_attr:    circle.getAttribute('data-topo-hub-highlight-recede'),
    has_animate:    !!circle.querySelector('animate[attributeName="opacity"]'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceIIFE = /const hubRecede = !!\(\(hoveredAlias \|\| hoveredEdgeKey \|\| hoveredGroupLabel/.test(src);
const sourceOpacityMultiplier = /const resolvedOpacity = hubRecede \? baseOpacity \* 0\.85 : baseOpacity;/.test(src);
const sourceBreathGate = /const breathActive = !reducedMotion && workingCount === 0 && !hubRecede;/.test(src);
const sourceAnimateGate = /\{breathActive && \(\s*<animate/.test(src);

const approxEq = (a, b) => Math.abs(parseFloat(a) - b) < 0.01;

const results = {
  rest_opacity_095:    rest && approxEq(rest.opacity_attr, 0.95),
  rest_breath_true:    rest && rest.breath_attr === 'true',
  rest_recede_false:   rest && rest.recede_attr === 'false',
  rest_has_animate:    rest && rest.has_animate,
  hover_opacity_081:   hover && approxEq(hover.opacity_attr, 0.81),
  hover_breath_false:  hover && hover.breath_attr === 'false',
  hover_recede_true:   hover && hover.recede_attr === 'true',
  hover_no_animate:    hover && !hover.has_animate,
  release_opacity_095: release && approxEq(release.opacity_attr, 0.95),
  release_breath_true: release && release.breath_attr === 'true',
  release_recede_false:release && release.recede_attr === 'false',
  release_has_animate: release && release.has_animate,
  source_iife_wired:        sourceIIFE,
  source_multiplier_wired:  sourceOpacityMultiplier,
  source_breath_gate_wired: sourceBreathGate,
  source_animate_gate_wired:sourceAnimateGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R508 hub-highlight recede:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover),
  '\n  release:', JSON.stringify(release));
process.exit(ok ? 0 : 1);
