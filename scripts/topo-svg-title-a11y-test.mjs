/* Round 730 — SVG <title> a11y children on the 3 primary SVG text
 * anchors (watermark, recent panel title, legend panel title). Pure
 * additive a11y improvement: screen readers can now identify these
 * decorative SVG elements via their accessible name. No visible chrome
 * change (mouse tooltips don't fire because the elements have
 * pointer-events: none), no overlap risk.
 *
 * Pivot round: first non-breath-family addition after the R721–R729
 * triple-axis + meta-doc hexagon thread.
 *
 * Assertions:
 *   - Watermark <text> has a <title> child with expected text
 *   - Recent panel title (when rendered) has a <title> child
 *   - Legend panel title has a <title> child
 *   - Each title text matches the canonical format "<name> · <role>"
 *   - Existing breath animations on all 3 are preserved (regression)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  const recent    = document.querySelector('[data-recent-panel-title]');
  const legend    = document.querySelector('[data-legend-panel-title]');
  const titleOf = (el) => el?.querySelector('title')?.textContent ?? null;
  const smilCount = (el) => el?.querySelectorAll('animate').length ?? 0;
  return {
    watermark_present:        !!watermark,
    watermark_title_text:     titleOf(watermark),
    watermark_smil_count:     smilCount(watermark),     // expect 2 (R519 opacity + R712 letter-spacing)
    recent_present:           !!recent,
    recent_title_text:        titleOf(recent),
    recent_smil_count:        smilCount(recent),        // expect 2 (R700 opacity + R713 font-size)
    legend_present:           !!legend,
    legend_title_text:        titleOf(legend),
    legend_smil_count:        smilCount(legend),        // expect 2 (R701 opacity + R713 font-size)
  };
});

await browser.close();

const results = {
  watermark_title_present:        state.watermark_present && state.watermark_title_text === 'sleep2agi · brand watermark',
  watermark_smil_preserved:       state.watermark_smil_count === 2,
  /* Recent panel renders conditionally on flowLinks; same conditional-
   * presence pattern as R728. Treat as pass if not rendered, strict
   * check otherwise. */
  recent_title_present:           !state.recent_present || state.recent_title_text === 'recent signal · activity panel title',
  recent_smil_preserved:          !state.recent_present || state.recent_smil_count === 2,
  legend_title_present:           state.legend_present && state.legend_title_text === 'legend · status / vendor / runtime swatch panel',
  legend_smil_preserved:          state.legend_present && state.legend_smil_count === 2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R730 SVG <title> a11y children on 3 SVG text anchors (watermark + recent + legend titles):`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`);
process.exit(ok ? 0 : 1);
