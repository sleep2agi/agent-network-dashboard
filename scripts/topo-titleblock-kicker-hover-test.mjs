/* Round 555 verification: title-block kicker "Network Topology"
 * gains group-hover affordance via the R554 wrapper's `group` flag.
 * Closes the title-block cluster's hover coverage at 3 surfaces
 * (brand logo + H2 + kicker).
 *
 * Picks up small-label SPREAD direction (R554 idiom) — tracking-
 * widest (0.1em) → 0.13em on hover, plus color lift text-gray-500
 * #6b7280 → text-gray-400 #9ca3af.
 *
 * At text-xs (12px):
 *   tracking-widest = 1.2px per gap (rest)
 *   0.13em          = 1.56px per gap (hover)
 *
 * Test phases:
 *   1. rest: letter-spacing ≈ 1.2px, color = gray-500
 *   2. hover brand logo (sibling): kicker letter-spacing ≈ 1.56px,
 *      color = gray-400 (group-hover propagation)
 *   3. source: kicker className contains group-hover utilities
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
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000 });
await page.waitForTimeout(500);

const kickerSel = '[data-topo-section-kicker]';
const logoSel = '[data-topo-brand-logo]';

const parsePx = (s) => parseFloat((s || '').replace(/px$/, ''));
const parseLab = (s) => {
  const m = (s || '').match(/lab\(([0-9.]+)\s/) || (s || '').match(/oklab\(([0-9.]+)\s/);
  return m ? parseFloat(m[1]) : NaN;
};

// Phase 1: rest
const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    letterSpacing: cs.letterSpacing,
    color: cs.color,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    fontSize: cs.fontSize,
    trackingAttr: el.getAttribute('data-topo-section-kicker-hover-tracking'),
    colorAttr: el.getAttribute('data-topo-section-kicker-hover-color'),
  };
}, kickerSel);

// Phase 2: hover brand logo (sibling element) → group-hover propagation
await page.hover(logoSel);
await page.waitForTimeout(400);
const hoverLogo = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { letterSpacing: cs.letterSpacing, color: cs.color };
}, kickerSel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceKickerWired = /group-hover:text-gray-400/.test(src) &&
                          /group-hover:tracking-\[0\.13em\]/.test(src);
const sourceTransition = /transition-\[letter-spacing,color\] duration-200 ease-out/.test(src);
const sourceTrackingAttr = /data-topo-section-kicker-hover-tracking="0\.13em"/.test(src);
const sourceColorAttr    = /data-topo-section-kicker-hover-color="text-gray-400"/.test(src);

// Rest: tracking-widest 0.1em × 12px = 1.2px
// Hover: 0.13em × 12px = 1.56px
const restPx = parsePx(rest?.letterSpacing);
const hoverPx = parsePx(hoverLogo?.letterSpacing);

// Color: rest gray-500 ≈ #6b7280; hover gray-400 ≈ #9ca3af (lighter).
// Tailwind v4 may emit in lab/oklab; check that hover L > rest L.
const restL  = parseLab(rest?.color);
const hoverL = parseLab(hoverLogo?.color);
// Also handle the legacy rgb() case in case it's emitted that way
const colorVaries = rest?.color !== hoverLogo?.color;

const results = {
  rest_tracking_widest_1_2px: Math.abs(restPx - 1.2) < 0.1,
  hover_tracking_0_13em:      Math.abs(hoverPx - 1.56) < 0.1,
  hover_spreads_vs_rest:      hoverPx > restPx + 0.2,
  color_varies_on_hover:      colorVaries,
  hover_color_lighter:        !Number.isNaN(restL) && !Number.isNaN(hoverL) ? (hoverL > restL + 5) : true,
  rest_tracking_attr:         rest?.trackingAttr === '0.13em',
  rest_color_attr:            rest?.colorAttr === 'text-gray-400',
  transition_has_ls_color:    /letter-spacing/.test(rest?.transitionProperty || '') && /color/.test(rest?.transitionProperty || ''),
  transition_duration_200ms:  rest?.transitionDuration === '0.2s',
  source_kicker_wired:        sourceKickerWired,
  source_transition:          sourceTransition,
  source_tracking_attr:       sourceTrackingAttr,
  source_color_attr:          sourceColorAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R555 title-block kicker group-hover (spread + color lift):`,
  JSON.stringify(results, null, 2),
  `\n  rest letter-spacing: ${rest?.letterSpacing} (expect ≈ 1.2px)`,
  `\n  hover letter-spacing: ${hoverLogo?.letterSpacing} (expect ≈ 1.56px)`,
  `\n  rest color: ${rest?.color}`,
  `\n  hover color: ${hoverLogo?.color}`,
  `\n  font-size: ${rest?.fontSize}`,
  `\n  transition-property: ${rest?.transitionProperty}`);
process.exit(ok ? 0 : 1);
