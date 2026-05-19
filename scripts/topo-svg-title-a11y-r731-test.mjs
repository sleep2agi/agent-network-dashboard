/* Round 731 — extend SVG <title> a11y children to 2 more decorative
 * SVG elements: title-block brand logo + canvas-corner crescent mark.
 * Continues R730's a11y sub-family thread.
 *
 * R730 + R731 a11y title coverage so far (5 elements):
 *   R730 watermark <text>           "sleep2agi · brand watermark"
 *   R730 recent panel title         "recent signal · activity panel title"
 *   R730 legend panel title         "legend · status / vendor / runtime swatch panel"
 *   R731 title-block brand logo     "sleep2agi · brand logo"
 *   R731 canvas-corner crescent     "sleep2agi · canvas-corner brand mark"
 *
 * Canonical title format: "<surface-name> · <structural-role>".
 *
 * Assertions:
 *   - Brand logo <svg> has a <title> child with expected text
 *   - Canvas-corner crescent <g> has a <title> child with expected text
 *   - Both follow the canonical "<name> · <role>" format
 *   - R730 watermark title still present (regression)
 *   - R730 legend title still present (regression)
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
await page.waitForSelector('[data-topo-brand-logo]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  const brandLogo  = document.querySelector('[data-topo-brand-logo]');
  const canvasMark = document.querySelector('[data-topo-brand-canvas-mark]');
  const watermark  = document.querySelector('[data-topo-brand-watermark]');
  const legend     = document.querySelector('[data-legend-panel-title]');
  /* Get DIRECT child <title> (not descendant) so we don't pick up
   * titles from nested SVG elements inside the brand logo's mask defs. */
  const directTitleText = (el) => {
    if (!el) return null;
    for (const child of el.children) {
      if (child.tagName.toLowerCase() === 'title') return child.textContent;
    }
    return null;
  };
  return {
    brand_logo_title:    directTitleText(brandLogo),
    canvas_mark_title:   directTitleText(canvasMark),
    watermark_title:     directTitleText(watermark),
    legend_title:        directTitleText(legend),
  };
});

await browser.close();

const canonicalFormat = (s) => typeof s === 'string' && /^[^·]+ · [^·]+$/.test(s);

const results = {
  brand_logo_title_present:        state.brand_logo_title === 'sleep2agi · brand logo',
  canvas_mark_title_present:       state.canvas_mark_title === 'sleep2agi · canvas-corner brand mark',
  brand_logo_canonical_format:     canonicalFormat(state.brand_logo_title),
  canvas_mark_canonical_format:    canonicalFormat(state.canvas_mark_title),
  r730_watermark_title_kept:       state.watermark_title === 'sleep2agi · brand watermark',
  r730_legend_title_kept:          state.legend_title === 'legend · status / vendor / runtime swatch panel',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R731 SVG <title> a11y extension to brand logo + canvas-corner crescent:`,
  JSON.stringify(results, null, 2),
  `\n  state: ${JSON.stringify(state)}`);
process.exit(ok ? 0 : 1);
