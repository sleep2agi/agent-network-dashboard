/* Round 167 verification: node status-ring picks up stroke-width
 * transition.
 *
 * Pre-R167 the node outer ring (cx,cy,r,fill,stroke + binary
 * stroke-width 3/1.5 + dasharray) had transition-[fill,stroke]
 * duration-300 — colors transitioned but stroke-width snapped
 * when a session went working → offline. R167 adds stroke-width
 * to the transition list (300ms ease-out), symmetric with R165
 * (pressure-bar width) and R166 (edge stroke-width).
 *
 * Test:
 *   1. Mock 2 working + 2 offline sessions
 *   2. Probe each node's status ring (via data-node-status-ring)
 *   3. Working ring: strokeWidth=3, transition includes
 *      'stroke-width 300ms'
 *   4. Offline ring: strokeWidth=1.5, dasharray='5 5',
 *      transition includes 'stroke-width 300ms'
 *   5. Both rings expose data-node-status-ring with the status
 *      label
 *
 * The DOM attribute reflects the React-rendered value, not the
 * CSS-interpolated value during transitions — so the R51
 * overlap-test's stroke-width=3 / 1.5 selectors still match.
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
const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status, last) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: last, updated_at: last, last_seen_at: last,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('w1', 'working', fresh), mk('w2', 'working', fresh),
    mk('o1', 'offline', stale), mk('o2', 'offline', stale),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-node-status-ring]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const rings = [...document.querySelectorAll('[data-node-status-ring]')];
  return rings.map(r => ({
    label:       r.getAttribute('data-node-status-ring'),
    strokeWidth: parseFloat(r.getAttribute('stroke-width')),
    dasharray:   r.getAttribute('stroke-dasharray'),
    inlineTransition: r.style.transition || '',
    computedTransition: getComputedStyle(r).transition || '',
  }));
});

await browser.close();

const working = probe.filter(p => p.label === 'working');
const offline = probe.filter(p => p.label === 'offline');

const allHaveStrokeWidth = probe.every(p =>
  p.inlineTransition.includes('stroke-width 300ms') ||
  /stroke-width\s+0\.3s|stroke-width\s+300ms/.test(p.computedTransition));
const allHaveFill = probe.every(p =>
  p.inlineTransition.includes('fill 300ms') ||
  /fill\s+0\.3s|fill\s+300ms/.test(p.computedTransition));
const allHaveStroke = probe.every(p =>
  p.inlineTransition.includes('stroke 300ms') ||
  /[^-]stroke\s+0\.3s|[^-]stroke\s+300ms/.test(p.computedTransition));

const results = {
  four_rings_found:       probe.length === 4,
  two_working_rings:      working.length === 2,
  two_offline_rings:      offline.length === 2,
  working_strokeWidth_3:  working.every(p => p.strokeWidth === 3),
  offline_strokeWidth_15: offline.every(p => p.strokeWidth === 1.5),
  working_no_dasharray:   working.every(p => p.dasharray === 'none' || !p.dasharray),
  offline_dasharray_5_5:  offline.every(p => p.dasharray === '5 5'),
  all_have_stroke_width_transition: allHaveStrokeWidth,
  all_have_fill_transition:         allHaveFill,
  all_have_stroke_transition:       allHaveStroke,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} node status-ring transition:`, JSON.stringify(results),
  `\n  rings=`, probe);
process.exit(ok ? 0 : 1);
