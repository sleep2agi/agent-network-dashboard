/* Round 197 verification: legend swatch dot scales r 5.5 → 7 when
 * its row is hovered or pinned. Mirrors R177 hub hover-lift but at
 * legend grain.
 *
 * Pre-R197 the swatch was a flat constant r=5.5 — every other piece
 * of the row responded to hover/pin (R55 text brighten, R105 bg
 * tint, R144 1px row lift, R181 pin ring) but the swatch dot
 * itself stayed still. The dot is the row's visual-identity
 * anchor; making it grow gives the gesture full row-wide reach.
 *
 * Test (cyber/dark theme, 4 working sessions):
 *   1. Three swatches present: working / idle / offline.
 *   2. Idle: data-legend-swatch-state='idle', r ~ 5.5.
 *   3. Hover the "working" legend row, wait past 150ms transition.
 *   4. Working swatch: state='hover', r ~ 7.
 *   5. Other swatches (idle/offline) stay 'idle' + r ~ 5.5.
 *   6. Move away, wait — working swatch back to 'idle' + r 5.5.
 *   7. transition: r 150ms ease-out is in the inline style.
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
  const mk = (alias, status = 'working') => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-swatch]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = async () => page.evaluate(() => {
  return [...document.querySelectorAll('[data-legend-swatch]')].map(el => ({
    key:   el.getAttribute('data-legend-swatch'),
    state: el.getAttribute('data-legend-swatch-state'),
    // Read both computed CSS r (the transitionable property) and the
    // SVG attribute fallback. Chrome computes the CSS r as the live
    // value, including mid-transition interpolated values.
    cssR:  parseFloat(getComputedStyle(el).r),
    attrR: parseFloat(el.getAttribute('r') || ''),
    transition: el.style.transition,
  }));
});

const idle = await probe();

await page.hover('[data-legend-status="working"]');
await page.waitForTimeout(220);  // past 150ms r transition + margin
const hovered = await probe();

await page.mouse.move(0, 0);
await page.waitForTimeout(220);
const settled = await probe();

await browser.close();

const idleWorking  = idle.find(s => s.key === 'working');
const idleIdle     = idle.find(s => s.key === 'idle');
const idleOffline  = idle.find(s => s.key === 'offline');

const hovWorking   = hovered.find(s => s.key === 'working');
const hovIdle      = hovered.find(s => s.key === 'idle');
const hovOffline   = hovered.find(s => s.key === 'offline');

const settledWorking = settled.find(s => s.key === 'working');

const results = {
  three_swatches:           idle.length === 3,
  has_working_swatch:       !!idleWorking,
  has_idle_swatch:          !!idleIdle,
  has_offline_swatch:       !!idleOffline,

  idle_working_state_idle:  idleWorking?.state === 'idle',
  idle_working_r_small:     Math.abs((idleWorking?.cssR ?? idleWorking?.attrR ?? 0) - 5.5) < 0.4,
  transition_includes_r:    (idleWorking?.transition || '').includes('r') &&
                            (idleWorking?.transition || '').includes('150ms'),

  hov_working_state_hover:  hovWorking?.state === 'hover',
  hov_working_r_bigger:     (hovWorking?.cssR ?? hovWorking?.attrR ?? 0) > 6.5,
  hov_working_r_about_7:    Math.abs((hovWorking?.cssR ?? hovWorking?.attrR ?? 0) - 7) < 0.4,
  hov_idle_stays_idle:      hovIdle?.state === 'idle',
  hov_idle_r_unchanged:     Math.abs((hovIdle?.cssR ?? hovIdle?.attrR ?? 0) - 5.5) < 0.4,
  hov_offline_stays_idle:   hovOffline?.state === 'idle',

  settled_state_idle:       settledWorking?.state === 'idle',
  settled_r_back_small:     Math.abs((settledWorking?.cssR ?? settledWorking?.attrR ?? 0) - 5.5) < 0.4,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend swatch grow:`, JSON.stringify(results),
  `\n  idle:`,    idle,
  `\n  hovered:`, hovered,
  `\n  settled:`, settled);
process.exit(ok ? 0 : 1);
