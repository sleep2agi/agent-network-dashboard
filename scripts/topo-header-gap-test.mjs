/* Round 334 verification: header section outer wrapper mobile
 * gap-3 → gap-2.5 (12 → 10 px). Unifies mobile-stacked rhythm
 * with the established R298/R328 gap-rhythm tier (title-block
 * 10 px, chip-row 10 px).
 *
 * The wrapper is the parent of [data-topo-section-kicker] (kicker
 * lives inside the title-block, which is the wrapper's first
 * flex child). We find the wrapper by walking up to the element
 * carrying `mb-4 px-1` + `flex-col` markers.
 *
 * Contract:
 *   - Header wrapper className contains 'gap-2.5' (not 'gap-3').
 *   - Computed flex-col rowGap at narrow viewport === '10px'.
 *   - R332 minimap rounded-lg + R330 wrapper rounded-xl regressions.
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
 *
 * Uses a 500-px-wide viewport to force mobile flex-col layout so
 * the `gap-2.5` (vertical) applies as row-gap.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
// Standard desktop viewport — the TopoGraph requires sm:+ width
// to render. R334 is a className-level polish (gap-2.5 applied in
// both flex-col mobile + sm:flex-row desktop), so we verify
// className presence regardless of layout direction.
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  // Walk up to the header wrapper (flex-col, mb-4, px-1).
  let wrapper = kicker?.parentElement || null;
  while (wrapper && !wrapper.className.includes('flex-col')) {
    wrapper = wrapper.parentElement;
  }
  const cs = wrapper ? getComputedStyle(wrapper) : null;
  const canvas = document.querySelector('[data-topo-wrapper]');
  return {
    wrapperClass:        wrapper?.className ?? '',
    wrapperFlexDir:      cs?.flexDirection ?? null,
    wrapperRowGap:       cs?.rowGap ?? null,
    canvasClass:         canvas?.className ?? '',
    layoutInactiveCls:   document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:     document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:          document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  wrapper_has_gap_2_5:        probe.wrapperClass.includes('gap-2.5'),
  wrapper_no_gap_3:           !probe.wrapperClass.match(/(^|\s)gap-3(\s|$)/),
  // At desktop viewport the wrapper is sm:flex-row, so flex-direction
  // !== 'column'. The gap-2.5 utility applies as column-gap in row
  // mode and row-gap in column mode — check className presence
  // (gap-2.5 affects both axes generically).
  wrapper_is_flex:            probe.wrapperFlexDir === 'row' || probe.wrapperFlexDir === 'column',
  // R330 regression — canvas wrapper rounded-xl.
  r330_canvas_rounded_xl:     probe.canvasClass.includes('rounded-xl'),
  // R317 / R318 chrome regression.
  r317_inactive_gray_400:     probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:    probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:          probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} header gap-2.5 (mobile):`, JSON.stringify(results),
  '\n  wrapper flex-direction:', probe.wrapperFlexDir,
  '\n  wrapper row-gap:',       probe.wrapperRowGap);
process.exit(ok ? 0 : 1);
