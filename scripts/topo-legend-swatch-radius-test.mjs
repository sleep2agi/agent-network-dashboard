/* Round 295 verification: legend swatch idle radius 5.5 → 6.
 *
 * R197 grew the swatch on hover/pin from 5.5 → 7 (a 1.5px jump).
 * R295 bumps the idle radius to 6 so the hover delta becomes
 * a smoother 6→7 (1px lift). Idle reads slightly more like an
 * authored color anchor than a faint dot.
 *
 * Contract:
 *   - All [data-legend-swatch] circles have attribute r='6' (was 5.5).
 *   - data-legend-swatch-state='idle' on all (no fixture hover).
 *   - Three swatches present (working / idle / offline).
 *   - R294 pulse dots absent + R290 three radar rings intact.
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
  const mk = (alias, model, status) => ({
    alias, status, model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4', 'working'),
    mk('beta',  'gpt-4o',        'idle'),
    mk('gamma', 'claude-sonnet-4', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-legend-swatch]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const swatches = [...document.querySelectorAll('[data-legend-swatch]')];
  const samples = swatches.map(s => ({
    key:   s.getAttribute('data-legend-swatch'),
    rAttr: s.getAttribute('r'),
    rCss:  getComputedStyle(s).r,
    state: s.getAttribute('data-legend-swatch-state'),
  }));
  const pulses = document.querySelectorAll('[data-pulse-wrapper]');
  const rings = [...document.querySelectorAll('[data-topo-radar-ring]')]
    .map(r => r.getAttribute('data-topo-radar-ring')).sort((a, b) => +a - +b);
  return {
    samples,
    pulseCount:    pulses.length,
    radarRings:    rings,
  };
});
await browser.close();

const results = {
  three_swatches:           probe.samples.length === 3,
  all_idle_state:           probe.samples.every(s => s.state === 'idle'),
  all_radius_attr_6:        probe.samples.every(s => s.rAttr === '6'),
  all_computed_r_6:         probe.samples.every(s => /^6/.test(s.rCss || '')),
  r294_pulse_absent:        probe.pulseCount === 0,
  r290_three_rings:         JSON.stringify(probe.radarRings) === JSON.stringify(['170', '250', '330']),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend swatch radius:`, JSON.stringify(results),
  '\n  swatch samples:', probe.samples);
process.exit(ok ? 0 : 1);
