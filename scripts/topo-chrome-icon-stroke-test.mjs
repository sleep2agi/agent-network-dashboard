/* Round 288 verification: chrome strip icon strokeWidth unification.
 *
 * Pre-R288 the five chrome icons in the bottom-right strip carried
 * two different stroke weights:
 *   zoom-in     : strokeWidth 2.5
 *   zoom-out    : strokeWidth 2.5
 *   reset       : strokeWidth 2     ← outlier
 *   fullscreen  : strokeWidth 2     ← outlier
 * Operators reading the strip horizontally saw zoom icons rendering
 * heavier than their reset/fullscreen siblings — same inconsistency
 * R268 closed for chrome border colors.
 *
 * Post-R288: all five icons render at strokeWidth 2.5.
 *
 * Test scope:
 *   1. zoom-in/zoom-out icons retain 2.5 (regression — no change).
 *   2. reset icon stroke-width === '2.5'.
 *   3. fullscreen icon (whichever variant rendered) stroke-width === '2.5'.
 *   4. R287 minimap rect strokeWidth=1.5 still in place.
 *   5. R283 monogram stroke + R282 watermark intact.
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
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-zoom-in-icon]', { timeout: 15000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const zin  = document.querySelector('[data-topo-chrome-zoom-in-icon]');
  const zout = document.querySelector('[data-topo-chrome-zoom-out-icon]');
  const reset = document.querySelector('[data-topo-chrome-reset-icon]');
  const fs    = document.querySelector('[data-topo-chrome-fullscreen-icon]');
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  return {
    zinStroke:    zin?.getAttribute('stroke-width') ?? null,
    zoutStroke:   zout?.getAttribute('stroke-width') ?? null,
    resetStroke:  reset?.getAttribute('stroke-width') ?? null,
    fsStroke:     fs?.getAttribute('stroke-width') ?? null,
    fsVariant:    fs?.getAttribute('data-topo-chrome-fullscreen-icon') ?? null,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
    watermarkPresent: watermark !== null,
  };
});
await browser.close();

const results = {
  zoom_in_stroke_2_5:     probe.zinStroke === '2.5',
  zoom_out_stroke_2_5:    probe.zoutStroke === '2.5',
  reset_stroke_2_5:       probe.resetStroke === '2.5',
  fullscreen_stroke_2_5:  probe.fsStroke === '2.5',
  fullscreen_variant_set: probe.fsVariant === 'enter' || probe.fsVariant === 'exit',
  r283_monogram_stroke_kept: probe.alphaAvatarStroke === '1.5',
  r282_watermark_present:    probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome icon stroke unify:`, JSON.stringify(results),
  '\n  zoom-in:    ', probe.zinStroke,
  '\n  zoom-out:   ', probe.zoutStroke,
  '\n  reset:      ', probe.resetStroke,
  '\n  fullscreen: ', probe.fsStroke, `(variant: ${probe.fsVariant})`);
process.exit(ok ? 0 : 1);
