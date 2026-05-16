/* Round 240 verification: backdrop spokes (6 radar-style lines)
 * tint to pal.legendAccent on any pinned filter, mirroring R93's
 * tier-ring treatment. Background scaffolding now signals
 * 'filtered mode' as a unified set instead of half-and-half.
 *
 * Cyber theme palette:
 *   pal.ringStroke   = #164e63 = rgb(22, 78, 99)
 *   pal.legendAccent = #67e8f9 = rgb(103, 232, 249)
 *
 * Test scope:
 *   - rest state (no pin):  all 6 spokes stroke = ringStroke
 *   - pinned state:         all 6 spokes stroke = legendAccent
 *   - transition wiring:    style.transition contains 'stroke 200ms'
 *     (browser may normalise to '0.2s' — accept either)
 *   - data-topo-spoke-tinted attr flips false ↔ true
 *
 * Scenario: 4 working agents (single tier, simple geometry).
 * Click the working pressure-bar segment to pin status=working.
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
await ctx.route('**/api/hub/messages*', (r2) => r2.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r2) => r2.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-spoke-angle]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(400);

const probeSpokes = (page) => page.evaluate(() => {
  const spokes = Array.from(document.querySelectorAll('[data-topo-spoke-angle]'));
  return spokes.map((s) => ({
    angle:      s.getAttribute('data-topo-spoke-angle'),
    tinted:     s.getAttribute('data-topo-spoke-tinted'),
    fill:       getComputedStyle(s).stroke,
    transition: getComputedStyle(s).transition,
  }));
});

const rest = await probeSpokes(page);

// Pin working status via pressure-bar segment click
await page.locator('[data-pressure-seg="working"]').first().click();
await page.waitForTimeout(400);
const pinned = await probeSpokes(page);

await browser.close();

const RING_RGB   = 'rgb(22, 78, 99)';
const ACCENT_RGB = 'rgb(103, 232, 249)';
// Browser normalises 200ms → 0.2s
const hasTransition = (s) => /stroke\s+(?:200ms|0\.2s)/.test(s || '');

const results = {
  six_spokes:             rest.length === 6,
  rest_all_untinted:      rest.every(s => s.tinted === 'false'),
  rest_all_ring_stroke:   rest.every(s => s.fill === RING_RGB),
  rest_all_has_transition: rest.every(s => hasTransition(s.transition)),

  pinned_six_spokes:      pinned.length === 6,
  pinned_all_tinted:      pinned.every(s => s.tinted === 'true'),
  pinned_all_accent:      pinned.every(s => s.fill === ACCENT_RGB),
  pinned_all_has_transition: pinned.every(s => hasTransition(s.transition)),

  // Angles match the original 0/30/60/90/120/150 pattern (sanity)
  angles_correct:         JSON.stringify(rest.map(s => s.angle).sort())
                          === JSON.stringify(['0','120','150','30','60','90']),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} spoke tint:`, JSON.stringify(results),
  '\n  rest:  ',   rest.map(s => ({ a: s.angle, t: s.tinted, fill: s.fill })),
  '\n  pinned:',   pinned.map(s => ({ a: s.angle, t: s.tinted, fill: s.fill })));
process.exit(ok ? 0 : 1);
