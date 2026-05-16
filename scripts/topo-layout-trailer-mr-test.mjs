/* Round 329 verification: Layout toggle wrapper `mr-1` → `mr-0.5`
 * to restore R260's 12px effective semantic gap after R328's chip-row
 * gap-2.5 (10px) bump.
 *
 * R260 designed for an effective 12px gap between the Layout CONTROL
 * and the first DISPLAY chip:
 *   pre-R260: chip-row gap-2 (8px) + mr-1 (4px) = 12px ✓
 *   R328:     chip-row gap-2.5 (10px) + mr-1 (4px) = 14px (drift)
 *   R329:     chip-row gap-2.5 (10px) + mr-0.5 (2px) = 12px ✓
 *
 * Contract:
 *   - [data-topo-chrome-layout-trailer] className contains 'mr-0.5'
 *     (not 'mr-1').
 *   - Computed margin-right === '2px'.
 *   - R328 chip-row gap-2.5 regression: parent chip-row column-gap=10px.
 *   - R326 chrome regression: chrome column-gap=8px.
 *   - R317 / R318 / R294 chrome + pulse regressions intact.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
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
await page.waitForSelector('[data-topo-chrome-layout-trailer]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const trailer = document.querySelector('[data-topo-chrome-layout-trailer]');
  let chipRow = trailer?.parentElement || null;
  while (chipRow && !chipRow.className.includes('flex-wrap')) {
    chipRow = chipRow.parentElement;
  }
  const chrome = document.querySelector('[data-topo-chrome]');
  return {
    trailerClass:       trailer?.className ?? '',
    trailerMarginRight: trailer ? getComputedStyle(trailer).marginRight : null,
    chipRowGap:         chipRow ? getComputedStyle(chipRow).columnGap : null,
    chromeGap:          chrome ? getComputedStyle(chrome).columnGap : null,
    layoutInactiveCls:  document.querySelector('[data-topo-chrome-layout="grid"]')?.className ?? '',
    layoutActiveCls:    document.querySelector('[data-topo-chrome-layout="ring"]')?.className ?? '',
    pulseCount:         document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const results = {
  trailer_has_mr_0_5:           probe.trailerClass.includes('mr-0.5') && !probe.trailerClass.includes('mr-1 '),
  trailer_margin_right_2px:     probe.trailerMarginRight === '2px',
  r328_chip_row_gap_10px:       probe.chipRowGap === '10px',
  r326_chrome_gap_8px:          probe.chromeGap === '8px',
  r317_inactive_gray_400:       probe.layoutInactiveCls.includes('text-gray-400'),
  r318_active_font_medium:      probe.layoutActiveCls.includes('font-medium'),
  r294_pulse_absent:            probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout-trailer mr-0.5:`, JSON.stringify(results),
  '\n  trailer margin-right:', probe.trailerMarginRight,
  '\n  chip-row column-gap: ', probe.chipRowGap,
  '\n  chrome column-gap:   ', probe.chromeGap);
process.exit(ok ? 0 : 1);
