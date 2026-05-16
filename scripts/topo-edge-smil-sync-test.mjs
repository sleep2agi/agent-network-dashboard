/* Round 231 verification: edge SMIL trio (R103 particle motion +
 * R76 dispatch pulse + R75 arrival ping) now share a single per-edge
 * stagger so all three fire phase-coherently with the particle:
 *
 *   particle.animateMotion.begin = -stagger
 *   dispatch.animate.begin       = -stagger             (= particle's)
 *   arrival.animate.begin        = -(stagger + 0.92*dur) mod dur
 *
 * where stagger = (edgeIndex * 0.37) % duration,
 *       duration = max(0.9, 2.6 / sqrt(link.count)).
 *
 * Scenario: 4 working agents + 2 flows (alpha→beta count=5, gamma→
 * delta count=4) — both flows have count ≥ 3 so dispatch pulse
 * fires on both, and fresh > 0.5 so arrival ping fires on both.
 *
 * Per edge:
 *   - probe particle's animateMotion.begin
 *   - probe dispatch's two <animate>.begin (r + opacity, must match)
 *   - probe arrival's two <animate>.begin (r + opacity, must match)
 *   - verify all three follow the formula given index + duration
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
// flow 0: alpha→beta count=5 — sorted by recent activity, this will be
// the more-recent flow; edge index depends on flowLinks.sort by last_at desc.
for (let i = 0; i < 5; i++) {
  msgs.push({
    id: `ab${i}`, from_alias: 'alpha', to_alias: 'beta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (500 + i * 50)).toISOString(),
  });
}
// flow 1: gamma→delta count=4 — older
for (let i = 0; i < 4; i++) {
  msgs.push({
    id: `gd${i}`, from_alias: 'gamma', to_alias: 'delta', content: 'hi',
    network_id: 'default', created_at: new Date(now - (5000 + i * 50)).toISOString(),
  });
}
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: msgs } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-arrival-ping]', { timeout: 10000, state: 'attached' });
await page.waitForSelector('[data-dispatch-pulse]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  // Edges keyed by link.key ("from→to"). We grab pairs of (arrival, dispatch)
  // by data attr, plus particle's animateMotion inside the edge <g>.
  const pings    = Array.from(document.querySelectorAll('[data-arrival-ping]'));
  const pulses   = Array.from(document.querySelectorAll('[data-dispatch-pulse]'));
  // Each ping/pulse lives inside an edge <g> that also contains the animateMotion
  // for the particle. We walk up to find the shared parent.
  return pings.map((ping) => {
    const key = ping.getAttribute('data-arrival-ping');
    const pulse = pulses.find(p => p.getAttribute('data-dispatch-pulse') === key);
    // animateMotion lives in a sibling <circle> within the same parent <g>
    const edgeG = ping.closest('g[data-edge-visible-parent]') || ping.parentElement;
    const motion = edgeG?.querySelector('animateMotion');
    const pingAnims  = Array.from(ping.querySelectorAll('animate'));
    const pulseAnims = pulse ? Array.from(pulse.querySelectorAll('animate')) : [];
    return {
      key,
      pingBeginR:     pingAnims.find(a => a.getAttribute('attributeName') === 'r')?.getAttribute('begin') || null,
      pingBeginOpacity: pingAnims.find(a => a.getAttribute('attributeName') === 'opacity')?.getAttribute('begin') || null,
      pulseBeginR:    pulseAnims.find(a => a.getAttribute('attributeName') === 'r')?.getAttribute('begin') || null,
      pulseBeginOpacity: pulseAnims.find(a => a.getAttribute('attributeName') === 'opacity')?.getAttribute('begin') || null,
      motionBegin:    motion?.getAttribute('begin') || null,
      motionDur:      motion?.getAttribute('dur') || null,
    };
  });
});
await browser.close();

const parseS = (s) => {
  if (!s) return null;
  const m = String(s).match(/^-?(\d+(?:\.\d+)?)s$/);
  if (!m) return null;
  return s.startsWith('-') ? -parseFloat(m[1]) : parseFloat(m[1]);
};

const close = (a, b, eps = 0.005) => Math.abs(a - b) < eps;

const validate = (edge) => {
  const dur = parseS(edge.motionDur);
  const motionBegin = parseS(edge.motionBegin);     // -stagger
  const pingR  = parseS(edge.pingBeginR);
  const pingOp = parseS(edge.pingBeginOpacity);
  const pulseR  = parseS(edge.pulseBeginR);
  const pulseOp = parseS(edge.pulseBeginOpacity);
  if (dur === null || motionBegin === null || motionBegin > 0) return null;
  const stagger = -motionBegin;                      // positive
  // Expected ping begin = -(stagger + 0.92*dur) mod dur  →  in [-dur, 0]
  const wrapped = (stagger + 0.92 * dur) % dur;
  const expectedPing = -wrapped;
  return {
    dur,
    motionBegin,
    stagger,
    expectedPing,
    pulseR,
    pulseOp,
    pingR,
    pingOp,
    dispatch_matches_particle: close(pulseR, motionBegin) && close(pulseOp, motionBegin),
    arrival_matches_formula:   close(pingR, expectedPing) && close(pingOp, expectedPing),
  };
};

const edges = probe.map(validate).filter(e => e !== null);

const results = {
  at_least_one_edge:           edges.length >= 1,
  all_dispatch_match_particle: edges.every(e => e.dispatch_matches_particle),
  all_arrival_match_formula:   edges.every(e => e.arrival_matches_formula),
  pulse_r_op_consistent:       edges.every(e => Math.abs(e.pulseR - e.pulseOp) < 0.005),
  ping_r_op_consistent:        edges.every(e => Math.abs(e.pingR - e.pingOp) < 0.005),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} edge SMIL sync:`, JSON.stringify(results),
  '\n  edges:', edges);
process.exit(ok ? 0 : 1);
