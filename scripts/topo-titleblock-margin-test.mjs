/* Round 299 verification: title block container bottom margin
 * mb-3 (12px) → mb-4 (16px). After R298 tightened title-block
 * INTERNAL gap (12→10px), the OUTER margin to the topology canvas
 * widens so the title block reads as a deliberate compact badge
 * with breathing room before the canvas frame begins.
 *
 * Contract:
 *   - The container wrapping [data-topo-section-kicker] +
 *     [data-topo-section-title] has computed margin-bottom 16px.
 *   - R298 internal gap === 10px still in place (regression).
 *   - R297 brand-logo transition + R296 kicker color + R295 swatch
 *     r=6 + R294 pulse absent intact.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const logo = document.querySelector('[data-topo-brand-logo]');
  // Title-block flex container is logo.parentElement. The OUTER margin
  // belongs to logo.parentElement.parentElement (the title-block wrapper
  // that holds left flex + right chip-row).
  const titleBlockContainer = logo?.parentElement?.parentElement;
  const tbCs = titleBlockContainer ? getComputedStyle(titleBlockContainer) : null;
  const flexParent = logo?.parentElement;
  const flexCs = flexParent ? getComputedStyle(flexParent) : null;
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  return {
    titleBlockMarginBottom: tbCs?.marginBottom ?? null,
    titleBlockClass:        titleBlockContainer?.className ?? null,
    leftFlexGap:            flexCs?.columnGap ?? null,
    brandLogoTransition:    logo ? getComputedStyle(logo).transition : null,
    swatchR:                swatch?.getAttribute('r') ?? null,
    pulseCount:             document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const mb = parseFloat(probe.titleBlockMarginBottom) || 0;
const gap = parseFloat(probe.leftFlexGap) || 0;

const results = {
  margin_bottom_16px:        mb >= 15.5 && mb <= 16.5,
  margin_not_12px:           !(mb >= 11.5 && mb <= 12.5),
  r298_left_gap_10px_kept:   gap >= 9.5 && gap <= 10.5,
  r297_transition_kept:      /color/.test(probe.brandLogoTransition || ''),
  r295_swatch_r_6:           probe.swatchR === '6',
  r294_pulse_absent:         probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} title-block margin:`, JSON.stringify(results),
  '\n  margin-bottom:', probe.titleBlockMarginBottom,
  '\n  left flex gap (R298):', probe.leftFlexGap);
process.exit(ok ? 0 : 1);
