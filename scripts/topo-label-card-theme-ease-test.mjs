/* Round 246 verification: node label card chrome rect picks up
 * fill + opacity transitions to coordinate with the existing
 * filter (R142) + stroke (R217) easing on the same element.
 *
 * Pre-R246 the rect transition list was 'filter 220ms ease-out,
 * stroke 220ms ease-out'. fill (pal.labelBox.fill: cyber dark ↔
 * light white) and opacity (cyber 0.94, light 1) snapped on theme
 * toggle. Surrounding elements already ease theme:
 *   R211 alias/sub text fill (same card)
 *   R242 chat-target ring filter + stroke
 *   R244 hub + halo opacity
 *   R245 edge stroke
 *
 * R246 closes the label-card chrome — adds fill + opacity to the
 * existing transition list so the whole card (background + text)
 * eases as one unit through theme switches and any future
 * fill/opacity state changes.
 *
 * Test scope per visible label card:
 *   - element present at [data-node-label-card]
 *   - style.transition contains filter, stroke, fill, AND opacity
 *     each at 220ms (or 0.22s browser-normalised)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.setItem('anet-topo-layout', 'ring');
  } catch {}
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
await page.waitForSelector('[data-node-label-card]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('[data-node-label-card]'));
  return cards.map((r) => ({
    alias:      r.getAttribute('data-node-label-card'),
    elevation:  r.getAttribute('data-node-label-card-elevation'),
    transition: r.style.transition,
  }));
});
await browser.close();

const hasProp = (s, prop) => new RegExp(`${prop}\\s+(?:220ms|0\\.22s)`).test(s || '');

const results = {
  four_cards:                probe.length === 4,
  all_have_alias:            probe.every(p => typeof p.alias === 'string'),
  all_idle_elevation:        probe.every(p => p.elevation === 'idle'),
  all_have_filter_220:       probe.every(p => hasProp(p.transition, 'filter')),
  all_have_stroke_220:       probe.every(p => hasProp(p.transition, 'stroke')),
  all_have_fill_220:         probe.every(p => hasProp(p.transition, 'fill')),
  all_have_opacity_220:      probe.every(p => hasProp(p.transition, 'opacity')),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} label card theme ease:`, JSON.stringify(results),
  '\n  cards:', probe.map(p => ({ a: p.alias, e: p.elevation, t: (p.transition || '').slice(0, 100) })));
process.exit(ok ? 0 : 1);
