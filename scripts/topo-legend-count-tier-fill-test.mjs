/* Round 239 verification: legend count text fill picks up the
 * row's tier colour on hover/pin, completing the hover-deepen-own-
 * hue idiom for the legend row triple (swatch + label + count).
 *
 * Pre-R239 the count digit had opacity 0.65→0.95 on hover but
 * stayed at pal.legendText (neutral gray) for fill. The swatch
 * (R197 grow) and label (R55 brighten) both reacted to hover with
 * tier-identity signals; only the count stayed gray. R239 adds
 * fill transition to row.fill (green/teal/slate) on hover so the
 * row reads as one tier-coloured unit.
 *
 * Empty tiers (row.count === 0) stay at pal.legendText regardless
 * of hover — empty doesn't get to claim tier identity.
 *
 * Test scope:
 *   - rest state: count fill === neutral (pal.legendText)
 *   - hover state (Playwright .hover() on the legend row <g>):
 *     count fill === row.fill (tier colour)
 *   - data-legend-count-fill attr flips 'neutral' ↔ 'tier'
 *   - transition list includes both opacity AND fill at 150ms
 *
 * Scenario: 4 working agents → working tier has count=4 (populated),
 * idle + offline tiers stay at 0 (empty, never tier-coloured).
 * Hover the working legend row, verify only that row's count
 * flips to tier colour.
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
await page.waitForSelector('[data-legend-count="working"]', { timeout: 10000, state: 'attached' });
await page.waitForTimeout(300);

const probeCount = (page, tier) => page.evaluate((t) => {
  const text = document.querySelector(`[data-legend-count="${t}"]`);
  if (!text) return null;
  const cs = getComputedStyle(text);
  return {
    fillAttr:   text.getAttribute('fill'),
    fillComp:   cs.fill,
    empty:      text.getAttribute('data-legend-count-empty'),
    fillState:  text.getAttribute('data-legend-count-fill'),
    transition: cs.transition,
    text:       (text.textContent || '').trim(),
  };
}, tier);

// REST STATE — no hover
const rest = await probeCount(page, 'working');

// HOVER STATE — hover the working legend row group
await page.locator('[data-legend-status="working"]').first().hover({ force: true });
await page.waitForTimeout(400);
const hover = await probeCount(page, 'working');

// Idle tier is empty in this scenario — should stay neutral even
// when hovered. Hover the idle row to confirm the empty-tier
// exclusion holds.
await page.locator('[data-legend-status="idle"]').first().hover({ force: true });
await page.waitForTimeout(400);
const idleHover = await probeCount(page, 'idle');

await browser.close();

// Browser normalises '150ms' → '0.15s' in computed-style transitions.
// Accept either form.
const hasTransition = (s, prop) => new RegExp(`${prop}\\s+(?:150ms|0\\.15s)`).test(s || '');
// Cyber theme working tier fill is #22c55e = rgb(34, 197, 94)
const tierColorRgb = 'rgb(34, 197, 94)';
// Cyber theme legendText (pal.legendText for dark palette) = #94a3b8 = rgb(148, 163, 184)
const neutralRgb = 'rgb(148, 163, 184)';

const results = {
  rest_present:               rest !== null,
  rest_fill_state_neutral:    rest?.fillState === 'neutral',
  rest_fill_is_neutral:       rest?.fillComp === neutralRgb,
  rest_text_is_4:             rest?.text === '4',
  rest_transition_has_fill:   hasTransition(rest?.transition, 'fill'),
  rest_transition_has_opacity: hasTransition(rest?.transition, 'opacity'),

  hover_fill_state_tier:      hover?.fillState === 'tier',
  hover_fill_is_tier:         hover?.fillComp === tierColorRgb,
  hover_text_is_4:            hover?.text === '4',

  // Empty tier (idle, count=0) stays neutral even on hover
  idle_empty:                 idleHover?.empty === 'true',
  idle_stays_neutral:         idleHover?.fillState === 'neutral',
  idle_fill_still_neutral:    idleHover?.fillComp === neutralRgb,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend count tier fill:`, JSON.stringify(results),
  '\n  rest:     ', rest,
  '\n  hover:    ', hover,
  '\n  idleHover:', idleHover);
process.exit(ok ? 0 : 1);
