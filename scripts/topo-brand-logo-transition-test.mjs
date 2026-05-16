/* Round 297 verification: brand-logo color transition.
 *
 * Codex's bbde2b7-era title-block sleep2agi crescent logo had
 * theme-conditional color (cyber #67e8f9 ↔ light #0d9488) but no
 * CSS transition — theme flips snapped the moon color in one
 * frame. R297 adds `transition: color 200ms ease-out` so the
 * brand mark joins the coordinated theme-toggle choreography
 * (R245/R246/R247/R253/R254).
 *
 * Contract:
 *   - [data-topo-brand-logo] is present (regression — codex's
 *     integration shipped).
 *   - computed transition includes 'color' with ~200ms duration.
 *   - computed color matches cyber palette (#67e8f9 in cyber theme).
 *   - R296 kicker color stays gray-500 (regression).
 *   - R295 swatch r=6 + R294 pulse absent intact.
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
  if (!logo) return null;
  const cs = getComputedStyle(logo);
  const kicker = document.querySelector('[data-topo-section-kicker]');
  const kCs = kicker ? getComputedStyle(kicker) : null;
  const swatch = document.querySelector('[data-legend-swatch="working"]');
  const pulses = document.querySelectorAll('[data-pulse-wrapper]');
  return {
    color:          cs.color,
    transition:     cs.transition,
    width:          logo.getAttribute('width'),
    kickerColor:    kCs?.color ?? null,
    swatchR:        swatch?.getAttribute('r') ?? null,
    pulseCount:     pulses.length,
  };
});
await browser.close();

const hasColorTransition = (s) => /color\s+0?\.?\d*s|color\s+\d+ms/i.test(s || '');
const isAround200ms = (s) => /(color\s+200ms|0\.2s)/i.test(s || '');

// gray-600 (#4b5563 = rgb(75,85,99))
const isNotGray600 = (s) => !/rgba?\(\s*75\s*,\s*85\s*,\s*99/.test(s || '');
// gray-500 (#6b7280 = rgb(107,114,128))
const isGrayish = (s) => /(rgb|oklab|lab|oklch|hsl)/.test(s || '');

const results = {
  brand_logo_present:       probe !== null,
  brand_logo_width_36:      probe?.width === '36',
  transition_has_color:     hasColorTransition(probe?.transition),
  transition_200ms:         isAround200ms(probe?.transition),
  r296_kicker_not_gray600:  isNotGray600(probe?.kickerColor),
  r296_kicker_grayish:      isGrayish(probe?.kickerColor),
  r295_swatch_r_6:          probe?.swatchR === '6',
  r294_pulse_absent:        probe?.pulseCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} brand-logo transition:`, JSON.stringify(results),
  '\n  logo color:', probe?.color,
  '\n  logo transition:', probe?.transition,
  '\n  kicker color:', probe?.kickerColor);
process.exit(ok ? 0 : 1);
