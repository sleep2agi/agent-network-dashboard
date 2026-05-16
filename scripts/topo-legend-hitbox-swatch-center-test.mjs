/* Round 271 verification: legend row hitbox centers exactly on the
 * swatch dot's cy.
 *
 * Pre-R271:
 *   Hitbox y = row.y0 - 12, height = 22 → center at row.y0 - 1
 *   Swatch cy = row.y0
 *   ⇒ Swatch sits 1 px above hitbox center (asymmetric tint band)
 *
 * Post-R271:
 *   Hitbox y = row.y0 - 11, height = 22 → center at row.y0
 *   Swatch cy = row.y0
 *   ⇒ Swatch sits exactly at hitbox center (symmetric tint band)
 *
 * Test scope:
 *   1. Hover the working row → tint rect appears (data-legend-row-tinted='hover').
 *   2. Tinted rect's getBBox.y === row.y0 - 11 (for working row.y0=32 → y=21).
 *   3. Tinted rect's getBBox.height === 22 (unchanged).
 *   4. Tinted rect's vertical center === swatch cy.
 *   5. R270 fullscreen inactive cyan hover regression intact.
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
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-legend-status="working"]', { timeout: 10000 });
await page.waitForSelector('[data-legend-swatch="working"]', { timeout: 10000 });
await page.waitForSelector('[data-topo-chrome-fullscreen]',  { timeout: 10000 });
await page.waitForTimeout(300);

// Hover the working row to force the tint rect to render
await page.locator('[data-legend-status="working"]').hover();
await page.waitForTimeout(250);

const probe = await page.evaluate(() => {
  const row = document.querySelector('[data-legend-status="working"]');
  if (!row) return null;
  // The hitbox rect is the FIRST <rect> inside the row group
  const rect = row.querySelector('rect');
  const swatch = row.querySelector('[data-legend-swatch="working"]');
  const fullscreen = document.querySelector('[data-topo-chrome-fullscreen]');
  return {
    rectY:      rect    ? +rect.getAttribute('y')      : null,
    rectHeight: rect    ? +rect.getAttribute('height') : null,
    rectTinted: rect    ? rect.getAttribute('data-legend-row-tinted') : null,
    swatchCy:   swatch  ? +swatch.getAttribute('cy')   : null,
    fullscreenClasses: fullscreen ? fullscreen.className.toString() : null,
  };
});
await browser.close();

const rectCenter = (probe.rectY != null && probe.rectHeight != null) ? probe.rectY + probe.rectHeight / 2 : null;
const centerMatchesSwatch = (rectCenter != null && probe.swatchCy != null) && rectCenter === probe.swatchCy;

const results = {
  rect_y_is_21:          probe.rectY === 21,
  rect_height_22:        probe.rectHeight === 22,
  rect_tinted_on_hover:  probe.rectTinted === 'hover',
  swatch_cy_32:          probe.swatchCy === 32,
  rect_center_matches_swatch: centerMatchesSwatch,
  r270_fullscreen_inactive_cyan: (probe.fullscreenClasses || '').includes('hover:bg-cyan-500/5'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} legend hitbox swatch center:`, JSON.stringify(results),
  '\n  rect y/height:', probe.rectY, probe.rectHeight, '(center', rectCenter, ')',
  '\n  swatch cy:', probe.swatchCy,
  '\n  rect tinted:', probe.rectTinted);
process.exit(ok ? 0 : 1);
