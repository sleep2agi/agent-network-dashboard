/* Round 554 verification: title-block H2 "Command mesh" gains
 * group-hover:tracking-tighter via the wrapper's `group` flag.
 * Hovering the brand logo OR the title text should tighten the
 * H2's kerning from -0.025em → -0.05em.
 *
 * Tailwind tracking utilities map to letter-spacing CSS:
 *   tracking-tight     -0.025em
 *   tracking-tighter   -0.05em
 *
 * At text-lg (18px font-size):
 *   tracking-tight   = -0.45px
 *   tracking-tighter = -0.9px
 *
 * Test phases:
 *   1. rest: H2 letter-spacing ≈ -0.45px (tracking-tight)
 *   2. hover brand logo: H2 letter-spacing ≈ -0.9px (tracking-tighter)
 *      Verifies group-hover propagation from sibling element.
 *   3. hover H2 itself: letter-spacing ≈ -0.9px (same)
 *   4. source: wrapper has `group`, H2 has group-hover:tracking-tighter
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
    letterSpacing: cs.letterSpacing,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    fontSize: cs.fontSize,
    hoverAttr: el.getAttribute('data-topo-section-title-hover-tracking'),
  };
}, h2Sel);

// Phase 2: hover brand logo (different element, but same group → H2 should tighten)
await page.hover(logoSel);
await page.waitForTimeout(400);
const hoverLogo = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { letterSpacing: cs.letterSpacing };
}, h2Sel);

// Phase 3: hover H2 itself (cross-confirm)
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover(h2Sel);
await page.waitForTimeout(400);
const hoverH2 = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { letterSpacing: cs.letterSpacing };
}, h2Sel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGroupWrapper = /<div className="group flex items-center gap-2\.5" data-topo-section-titleblock-group>/.test(src);
const sourceH2HoverTracking = /group-hover:tracking-tighter/.test(src);
const sourceH2HoverAttr = /data-topo-section-title-hover-tracking="tracking-tighter"/.test(src);

// Rest ≈ -0.45px (-0.025em × 18px), hover ≈ -0.9px (-0.05em × 18px)
const restPx = parsePx(rest?.letterSpacing);
const hoverLogoPx = parsePx(hoverLogo?.letterSpacing);
const hoverH2Px = parsePx(hoverH2?.letterSpacing);

const results = {
  rest_attr_present:           rest?.hoverAttr === 'tracking-tighter',
  rest_tracking_tight:         Math.abs(restPx - (-0.45)) < 0.05,
  hover_via_logo_tightens:     Math.abs(hoverLogoPx - (-0.9)) < 0.05,
  hover_via_h2_tightens:       Math.abs(hoverH2Px - (-0.9)) < 0.05,
  hover_tighter_than_rest:     hoverLogoPx < restPx - 0.3,
  transition_has_letter_spacing: /letter-spacing/.test(rest?.transitionProperty || ''),
  transition_duration_200ms:   rest?.transitionDuration === '0.2s',
  source_group_wrapper:        sourceGroupWrapper,
  source_h2_group_hover:       sourceH2HoverTracking,
  source_h2_attr:              sourceH2HoverAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R554 title-block H2 group-hover:tracking-tighter:`,
  JSON.stringify(results, null, 2),
  `\n  rest letter-spacing: ${rest?.letterSpacing} (expect ≈ -0.45px)`,
  `\n  hover-via-logo:      ${hoverLogo?.letterSpacing} (expect ≈ -0.9px)`,
  `\n  hover-via-h2:        ${hoverH2?.letterSpacing} (expect ≈ -0.9px)`,
  `\n  font-size:           ${rest?.fontSize}`,
  `\n  transition-property: ${rest?.transitionProperty}`);
process.exit(ok ? 0 : 1);
