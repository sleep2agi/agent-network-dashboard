/* Round 560 verification: chip-row chip UNIT spans + filter-pill
 * prefix/count + vendor-letter count suffix gain group-hover:
 * tracking-wide. Coordinated 7-occurrence replace_all swap
 * extends the hover-letter-spacing family across the small
 * data-label-spans-with-opacity-70 cohort.
 *
 * Test phases:
 *   1. rest: letter-spacing ≈ 'normal' (0px) on working-chip-unit
 *   2. hover the chip wrapper (group) → unit letter-spacing lifts
 *      to ≈ 0.025em ≈ 0.3px on a 12px font
 *   3. transition-property contains BOTH 'opacity' and
 *      'letter-spacing'
 *   4. source-side regex confirms the new className substring
 *      appears 7 times (replace_all touched all sites)
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
  const mk = (alias, status = 'working') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Working sessions so the working chip is clickable / hoverable.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('a·1', 'working'), mk('a·2', 'working'), mk('a·3', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-working-chip-unit]', { timeout: 15000 });
await page.waitForTimeout(500);

const unitSel = '[data-working-chip-unit]';
// Hover the parent chip (the <span> wrapping digit+unit) — group-hover.
// Walk up until we find the role='button' chip wrapper.
const chipWrapperHandle = await page.evaluateHandle((s) => {
  let el = document.querySelector(s);
  while (el && el.parentElement) {
    el = el.parentElement;
    if (el.getAttribute('role') === 'button' || el.getAttribute('aria-pressed') !== null) {
      return el;
    }
  }
  return el;
}, unitSel);

const parsePx = (s) => parseFloat((s || '').replace(/px$/, ''));

const rest = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    letterSpacing: cs.letterSpacing,
    transitionProperty: cs.transitionProperty,
    transitionDuration: cs.transitionDuration,
    fontSize: cs.fontSize,
    opacity: cs.opacity,
  };
}, unitSel);

// Hover the chip wrapper
await chipWrapperHandle.hover();
await page.waitForTimeout(400);
const hover = await page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    letterSpacing: cs.letterSpacing,
    opacity: cs.opacity,
  };
}, unitSel);

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
// Count occurrences of the new className
const occurrences = (src.match(/opacity-70 transition-\[opacity,letter-spacing\] duration-200 group-hover:opacity-100 group-hover:tracking-wide/g) || []).length;

// At text-xs (12px in chip-row context), tracking-wide = 0.025em = 0.3px
// At rest, letter-spacing = 'normal' which most browsers report as '0px'
// or 'normal'.
const restPx = parsePx(rest?.letterSpacing) || 0;
const hoverPx = parsePx(hover?.letterSpacing);

const results = {
  rest_letter_spacing_zero:   rest?.letterSpacing === 'normal' || Math.abs(restPx) < 0.01,
  hover_letter_spacing_wide:  Math.abs(hoverPx - 0.3) < 0.1, // tracking-wide @ 12px ≈ 0.3px
  hover_ls_greater_than_rest: hoverPx > restPx + 0.1,
  rest_opacity_0_7:           Math.abs(parseFloat(rest?.opacity || '0') - 0.7) < 0.01,
  hover_opacity_1:            Math.abs(parseFloat(hover?.opacity || '0') - 1.0) < 0.01,
  transition_has_opacity:     /opacity/.test(rest?.transitionProperty || ''),
  transition_has_ls:          /letter-spacing/.test(rest?.transitionProperty || ''),
  transition_duration:        rest?.transitionDuration === '0.2s' || /^0\.2s/.test(rest?.transitionDuration || ''),
  source_7_occurrences:       occurrences === 7,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R560 chip-row unit + filter-pill spans hover-tracking (7 anchors via replace_all):`,
  JSON.stringify(results, null, 2),
  `\n  rest: ${JSON.stringify(rest)}`,
  `\n  hover: ${JSON.stringify(hover)}`,
  `\n  source replace_all occurrences: ${occurrences}`);
process.exit(ok ? 0 : 1);
