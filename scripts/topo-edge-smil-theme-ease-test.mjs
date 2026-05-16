/* Round 252 verification: three SMIL edge elements (particle,
 * arrival ping, dispatch pulse) pick up theme-toggle transitions
 * on their static color attributes, closing the last per-edge
 * theme-toggle snaps.
 *
 * Pre-R252 each element had inline style with only pointerEvents
 * (or no style for particle). Theme-driven fill/stroke snapped:
 *   · particle:       fill=pal.flowParticle (cyber yellow ↔ light amber)
 *   · arrival ping:   stroke=pal.flowEdge (cyber cyan ↔ light emerald)
 *   · dispatch pulse: stroke=pal.flowEdge (same as ping)
 *
 * R252 adds 200ms transitions:
 *   · particle:       transition: fill 200ms, opacity 200ms
 *   · arrival ping:   transition: stroke 200ms
 *   · dispatch pulse: transition: stroke 200ms
 *
 * The SMIL animateMotion (particle path) + R228 spline-eased animates
 * (ping/pulse r + opacity) run independently of these CSS transitions
 * — no conflict; CSS handles static-color theme transitions, SMIL
 * handles animation values.
 *
 * Scenario: 4 working agents + 5-msg alpha→beta (count≥3, fresh>0.5)
 * → particle + arrival ping + dispatch pulse all rendered.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha'), mk('beta'), mk('gamma'), mk('delta'),
  ] } });
});
const now = Date.now();
const msgs = [];
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `m${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (1000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-edge-particle]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-arrival-ping]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-dispatch-pulse]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const grab = (sel) => {
    const el = document.querySelector(sel);
    return el ? { transition: el.style.transition, fill: el.getAttribute('fill'), stroke: el.getAttribute('stroke') } : null;
  };
  return {
    particle:       grab('[data-edge-particle]'),
    arrivalPing:    grab('[data-arrival-ping]'),
    dispatchPulse:  grab('[data-dispatch-pulse]'),
  };
});
await browser.close();

const has = (s, prop) => new RegExp(`${prop}\\s+(?:200ms|0\\.2s)`).test(s || '');

const results = {
  particle_present:           probe.particle !== null,
  particle_has_fill_200:      has(probe.particle?.transition, 'fill'),
  particle_has_opacity_200:   has(probe.particle?.transition, 'opacity'),

  arrival_ping_present:       probe.arrivalPing !== null,
  arrival_ping_has_stroke_200: has(probe.arrivalPing?.transition, 'stroke'),

  dispatch_pulse_present:     probe.dispatchPulse !== null,
  dispatch_pulse_has_stroke_200: has(probe.dispatchPulse?.transition, 'stroke'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge SMIL theme ease:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
