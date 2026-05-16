/* Round 300 (milestone) verification: kicker font-weight bumps from
 * default (400/normal) → font-medium (500). Uppercase eyebrow at
 * text-xs with R285 tracking-widest reads slightly under-authored
 * at 400; 500 lifts the label to the conventional SaaS-eyebrow
 * weight (Stripe / Vercel / Linear).
 *
 * Hierarchy preserved: h2 (600 font-semibold) > kicker (500 font-
 * medium) > body weight families.
 *
 * Contract:
 *   - [data-topo-section-kicker] computed font-weight === 500.
 *   - R296 kicker color (~gray-500) preserved.
 *   - R285 tracking-widest (~1.2px @ 12px) preserved.
 *   - R299 title-block mb=16px + R298 left flex gap=10px preserved.
 *   - R297 brand-logo transition + R294 pulse absent intact.
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
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const title  = document.querySelector('[data-topo-section-title]');
  const logo   = document.querySelector('[data-topo-brand-logo]');
  const kCs = kicker ? getComputedStyle(kicker) : null;
  const tCs = title  ? getComputedStyle(title)  : null;
  const flexParent = logo?.parentElement;
  const flexCs = flexParent ? getComputedStyle(flexParent) : null;
  const titleBlockContainer = flexParent?.parentElement;
  const tbCs = titleBlockContainer ? getComputedStyle(titleBlockContainer) : null;
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  return {
    kickerFontWeight: kCs?.fontWeight ?? null,
    kickerColor:      kCs?.color ?? null,
    kickerLetterSpacing: kCs?.letterSpacing ?? null,
    titleFontWeight:  tCs?.fontWeight ?? null,
    titleBlockMarginBottom: tbCs?.marginBottom ?? null,
    leftFlexGap:      flexCs?.columnGap ?? null,
    brandLogoTransition: logo ? getComputedStyle(logo).transition : null,
    swatchR:          swatch?.getAttribute('r') ?? null,
    pulseCount:       document.querySelectorAll('[data-pulse-wrapper]').length,
  };
});
await browser.close();

const kFw = parseInt(probe.kickerFontWeight) || 0;
const tFw = parseInt(probe.titleFontWeight) || 0;
const ls = parseFloat(probe.kickerLetterSpacing) || 0;
const mb = parseFloat(probe.titleBlockMarginBottom) || 0;
const gap = parseFloat(probe.leftFlexGap) || 0;

const results = {
  kicker_weight_500:        kFw === 500,
  title_weight_higher:      tFw > kFw,
  r285_tracking_widest:     ls >= 1.0 && ls <= 1.5,
  r296_kicker_color_not_gray600: !/rgba?\(\s*75\s*,\s*85\s*,\s*99/.test(probe.kickerColor || ''),
  r299_mb_16:               mb >= 15.5 && mb <= 16.5,
  r298_gap_10:              gap >= 9.5 && gap <= 10.5,
  r297_transition_kept:     /color/.test(probe.brandLogoTransition || ''),
  r295_swatch_r_6:          probe.swatchR === '6',
  r294_pulse_absent:        probe.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} kicker weight (R300 milestone):`, JSON.stringify(results),
  '\n  kicker font-weight:', probe.kickerFontWeight,
  '\n  title  font-weight:', probe.titleFontWeight,
  '\n  letter-spacing:', probe.kickerLetterSpacing,
  '\n  title-block mb (R299):', probe.titleBlockMarginBottom);
process.exit(ok ? 0 : 1);
