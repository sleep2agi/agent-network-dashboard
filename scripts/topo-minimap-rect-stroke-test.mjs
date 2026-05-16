/* Round 287 verification: minimap viewport rect strokeWidth bumps
 * 1 → 1.5. The rect frames the user's current view in the minimap —
 * it IS the wayfinding "you are here" indicator. Bumping the stroke
 * by half a pixel (same micro-polish family as R283 monogram stroke)
 * lifts the boundary above ambient minimap-dot density without
 * crowding the miniaturised dots inside.
 *
 * The minimap is only rendered when view ≠ default (zoomed or
 * panned). Test simulates a zoom to surface the minimap.
 *
 * Contract:
 *   - [data-topo-minimap-viewport] exists after zoom.
 *   - Its stroke-width attribute === "1.5".
 *   - data-topo-minimap-dot still rendered (≥1 dot regression).
 *   - R283 monogram stroke + R282 watermark intact (regression).
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
    mk('gamma', 'claude-sonnet-4'),
    mk('delta', null),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });

// Trigger zoom-in to surface the minimap. The zoom-in button is the
// '+' control inside the chrome strip.
await page.click('[data-topo-chrome-zoom-in]');
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const rect = document.querySelector('[data-topo-minimap-viewport]');
  const dots = document.querySelectorAll('[data-topo-minimap-dot]');
  const watermark = document.querySelector('[data-topo-brand-watermark]');
  const alphaNode = document.querySelector('g[data-node="alpha"]');
  const alphaCircles = alphaNode ? [...alphaNode.querySelectorAll('circle')] : [];
  const alphaAvatarCircle = alphaCircles
    .map(c => ({ r: +c.getAttribute('r') || 0, sw: c.getAttribute('stroke-width'), isBadge: c.hasAttribute('data-runtime-badge') }))
    .filter(c => c.r > 0 && c.r < 18 && !c.isBadge)
    .sort((a, b) => b.r - a.r)[0];
  return {
    rectPresent:       rect !== null,
    rectStrokeWidth:   rect?.getAttribute('stroke-width') ?? null,
    rectOpacity:       rect?.getAttribute('opacity') ?? null,
    dotCount:          dots.length,
    alphaAvatarStroke: alphaAvatarCircle?.sw ?? null,
    watermarkPresent:  watermark !== null,
  };
});
await browser.close();

const results = {
  minimap_rect_present:           probe.rectPresent,
  minimap_rect_stroke_is_1_5:     probe.rectStrokeWidth === '1.5',
  minimap_rect_opacity_kept:      probe.rectOpacity === '0.9',
  minimap_has_dots:               probe.dotCount >= 1,
  r283_monogram_stroke_kept:      probe.alphaAvatarStroke === '1.5',
  r282_watermark_present:         probe.watermarkPresent,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap rect stroke:`, JSON.stringify(results),
  '\n  rect strokeWidth:', probe.rectStrokeWidth,
  '\n  rect opacity:', probe.rectOpacity,
  '\n  dot count:', probe.dotCount,
  '\n  alpha avatar (R283):', probe.alphaAvatarStroke);
process.exit(ok ? 0 : 1);
