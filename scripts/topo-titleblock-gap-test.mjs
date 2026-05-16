/* Round 298 verification: title-block flex gap shrinks from gap-3
 * (12px) → gap-2.5 (10px). Tightens the brand-logo + kicker/h2 unit
 * to read as a single editorial "logo + title" badge rather than
 * two loosely-spaced elements.
 *
 * Contract:
 *   - The parent of [data-topo-brand-logo] has computed column-gap
 *     of 10px (gap-2.5 in Tailwind).
 *   - Pre-R298 was 12px (gap-3).
 *   - Brand-logo + kicker + h2 all still render in the title block.
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
  const flexParent = logo?.parentElement;
  const cs = flexParent ? getComputedStyle(flexParent) : null;
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const title  = document.querySelector('[data-topo-section-title]');
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  const pulses = document.querySelectorAll('[data-pulse-wrapper]');
  return {
    parentColumnGap: cs?.columnGap ?? null,
    parentGap:       cs?.gap ?? null,
    parentDisplay:   cs?.display ?? null,
    brandLogoPresent: logo !== null,
    kickerPresent:   kicker !== null,
    titlePresent:    title !== null,
    swatchR:         swatch?.getAttribute('r') ?? null,
    pulseCount:      pulses.length,
    brandLogoTransition: logo ? getComputedStyle(logo).transition : null,
  };
});
await browser.close();

const gapPx = parseFloat(probe.parentColumnGap) || parseFloat(probe.parentGap) || 0;

const results = {
  flex_parent_is_flex:   probe.parentDisplay === 'flex',
  gap_is_10px:           gapPx >= 9.5 && gapPx <= 10.5,
  brand_logo_present:    probe.brandLogoPresent,
  kicker_present:        probe.kickerPresent,
  title_present:         probe.titlePresent,
  r297_transition_kept:  /color/.test(probe.brandLogoTransition || ''),
  r295_swatch_r_6:       probe.swatchR === '6',
  r294_pulse_absent:     probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} title-block gap:`, JSON.stringify(results),
  '\n  computed column-gap:', probe.parentColumnGap,
  '\n  computed gap:', probe.parentGap,
  '\n  brand-logo transition (R297):', probe.brandLogoTransition);
process.exit(ok ? 0 : 1);
