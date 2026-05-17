/* Round 556 verification: title-block H2 "Command mesh" gains
 * a 2nd editorial-emphasis axis — group-hover:font-bold paired
 * with R554's group-hover:tracking-tighter.
 *
 * Test phases:
 *   1. rest: fontWeight = 600 (semibold), letter-spacing ≈ -0.45px
 *   2. hover brand logo (sibling, propagates via group-hover):
 *      H2 fontWeight = 700 (bold), letter-spacing ≈ -0.9px
 *   3. transition-property contains BOTH letter-spacing AND font-weight
 *   4. source-side regex confirms group-hover:font-bold wired
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-title]', { timeout: 15000 });
await page.waitForTimeout(500);

const h2Sel = '[data-topo-section-title]';
const logoSel = '[data-topo-brand-logo]';

const parsePx = (s) => parseFloat((s || '').replace(/px$/, ''));

// Phase 1: rest
const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    fontWeight:        cs.fontWeight,
    letterSpacing:     cs.letterSpacing,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    hoverFwAttr:       el.getAttribute('data-topo-section-title-hover-fw'),
    hoverTrackingAttr: el.getAttribute('data-topo-section-title-hover-tracking'),
  };
}, h2Sel);

// Phase 2: hover brand logo (sibling) → group-hover propagates
await page.hover(logoSel);
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing };
}, h2Sel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFwWired = /group-hover:font-bold/.test(src);
const sourceTransition = /transition-\[letter-spacing,font-weight\] duration-200 ease-out/.test(src);
const sourceFwAttr = /data-topo-section-title-hover-fw="700"/.test(src);

const restPx = parsePx(rest?.letterSpacing);
const hoverPx = parsePx(hover?.letterSpacing);

const results = {
  rest_fw_semibold:       rest?.fontWeight === '600',
  rest_tracking_tight:    Math.abs(restPx - (-0.45)) < 0.05,
  hover_fw_bold:          hover?.fontWeight === '700',
  hover_tracking_tighter: Math.abs(hoverPx - (-0.9)) < 0.05,
  // Both axes intensify together — confirm by directionality
  fw_intensifies:         parseInt(hover?.fontWeight || '0') > parseInt(rest?.fontWeight || '0'),
  tracking_intensifies:   hoverPx < restPx - 0.3, // more negative = tighter
  transition_has_ls:      /letter-spacing/.test(rest?.transitionProperty || ''),
  transition_has_fw:      /font-weight/.test(rest?.transitionProperty || ''),
  transition_duration:    rest?.transitionDuration === '0.2s',
  rest_hover_fw_attr:     rest?.hoverFwAttr === '700',
  rest_hover_tracking_attr: rest?.hoverTrackingAttr === 'tracking-tighter',
  source_fw_wired:        sourceFwWired,
  source_transition:      sourceTransition,
  source_fw_attr:         sourceFwAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R556 title-block H2 group-hover:font-bold (2-axis editorial emphasis):`,
  JSON.stringify(results, null, 2),
  `\n  rest: fw=${rest?.fontWeight}, ls=${rest?.letterSpacing}`,
  `\n  hover: fw=${hover?.fontWeight}, ls=${hover?.letterSpacing}`,
  `\n  transition: ${rest?.transitionProperty}`);
process.exit(ok ? 0 : 1);
