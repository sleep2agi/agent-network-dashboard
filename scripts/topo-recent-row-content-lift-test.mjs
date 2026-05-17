/* Round 635 — recent-row content preview opacity lifts 0.7 → 1.0
 * on isRowHovered || isRowPinned. 5th anchor in the inspection-
 * overrides-encoding family — extends the pattern to row CONTENT
 * (the truncated message preview, R418 subordinate 0.7 baseline).
 *
 * Test phases:
 *   1. mock 2 nodes + 1 message → recent-row + content tspan
 *      render
 *   2. rest (no hover, no pin): lifted='false', opacity-attr='0.7',
 *      computed opacity ≈ 0.7
 *   3. hover the row → lifted='true', opacity-attr='1', computed
 *      opacity ≈ 1
 *   4. computed transition contains 'opacity'
 *   5. source: <tspan> uses style.opacity gated on
 *      (isRowHovered || isRowPinned)
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { from_alias: 'a·1', to_alias: 'a·2', content: 'hello-world-preview', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-recent-row-content-tspan]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(500);

const rest = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-content-tspan]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    lifted:     el.getAttribute('data-recent-row-content-lifted'),
    opacityAttr:el.getAttribute('data-recent-row-content-opacity'),
    opacityRest:el.getAttribute('data-recent-row-content-opacity-rest'),
    opacityComputed: cs.opacity,
    transitionProperty: cs.transitionProperty,
  };
});

// Hover the row's parent <g> to trigger isRowHovered
// recent-row hover region — the row's pip rect serves as hitbox.
// Easier: dispatch mousemove over the row's tint rect.
const hovered = await page.evaluate(async () => {
  const tint = document.querySelector('[data-recent-row-tint-brightness]');
  if (!tint) return { error: 'no-tint' };
  const rect = tint.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // Use elementFromPoint to find the topmost interactive target
  const target = document.elementFromPoint(cx, cy);
  if (!target) return { error: 'no-target' };
  const event = new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy });
  target.dispatchEvent(event);
  return { ok: true };
});

// playwright hover route — find a recent-row-tint or content's parent text
await page.evaluate(() => {
  const tint = document.querySelector('[data-recent-row-tint-brightness]');
  if (!tint) return;
  const rect = tint.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // dispatch through the hitbox path — use Playwright's mouse.move proxy via real event
  const ev = new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy });
  document.elementFromPoint(cx, cy)?.dispatchEvent(ev);
});
// More reliable: use Playwright's hover API on tint rect element
const tintBox = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-tint-brightness]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (tintBox) await page.mouse.move(tintBox.x, tintBox.y);
await page.waitForTimeout(350);

const hover = await page.evaluate(() => {
  const el = document.querySelector('[data-recent-row-content-tspan]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    lifted:     el.getAttribute('data-recent-row-content-lifted'),
    opacityAttr:el.getAttribute('data-recent-row-content-opacity'),
    opacityComputed: cs.opacity,
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGate = /<tspan\s+data-recent-row-content-tspan\s+data-recent-row-content-lifted=\{\(isRowHovered \|\| isRowPinned\) \? 'true' : 'false'\}[\s\S]{0,300}opacity: \(isRowHovered \|\| isRowPinned\) \? 1 : 0\.7/.test(src);
const sourceTransition = /transition: 'opacity 200ms ease-out'/.test(src);

const results = {
  rest_present:           !!rest,
  rest_lifted_false:      rest?.lifted === 'false',
  rest_opacity_attr_07:   rest?.opacityAttr === '0.7',
  rest_opacity_rest_07:   rest?.opacityRest === '0.7',
  rest_opacity_computed:  Math.abs(parseFloat(rest?.opacityComputed || '0') - 0.7) < 0.05,
  rest_transition_opacity:/opacity/.test(rest?.transitionProperty || ''),
  hover_present:          !!hover,
  hover_lifted_true:      hover?.lifted === 'true',
  hover_opacity_attr_1:   hover?.opacityAttr === '1',
  hover_opacity_computed: Math.abs(parseFloat(hover?.opacityComputed || '0') - 1) < 0.05,
  source_gate:            sourceGate,
  source_transition:      sourceTransition,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R635 recent-row content opacity lift (inspection-overrides-encoding 5th anchor):`,
  JSON.stringify(results, null, 2),
  `\n  rest:  ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`);
process.exit(ok ? 0 : 1);
