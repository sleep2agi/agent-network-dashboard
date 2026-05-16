/* Round 282 verification: sleep2agi brand watermark at canvas bottom-left.
 *
 * Per Vincent 5215 ask via 通信龙 (logo placement on the canvas), R282
 * adds a low-opacity monospace text "sleep2agi" at viewBox (16, 672)
 * — bottom-left corner, the only fully-empty corner after R275-R281
 * 减法 arc:
 *   top-left:    recent-signal panel
 *   top-right:   legend panel
 *   bottom-right: chrome strip (HTML overlay)
 *   bottom-left: EMPTY → watermark home
 *
 * No icon yet (no sleep2agi-specific crescent asset in public/);
 * text-only watermark is the minimal-risk implementation. R283+
 * can swap in a real logo if Vincent provides asset.
 *
 * Test scope:
 *   1. data-topo-brand-watermark element exists.
 *   2. Text content === "sleep2agi".
 *   3. x === 16, y === 672 (bottom-left, 16-unit inset matching panels).
 *   4. opacity === "0.4" (subtle watermark).
 *   5. fill is set + theme-aware (not 'none', not empty).
 *   6. R281 vendor chip threshold regression: 2-vendor scenario chip absent.
 *   7. R280 spokes still retired (regression).
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
  // 2-vendor scenario (claude + gpt) so R281 vendor chip should be absent
  const mk = (alias, model) => ({
    alias, status: 'working', model, runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'claude-opus-4'),
    mk('beta',  'gpt-4o'),
    mk('gamma', 'claude-sonnet-4'),
    mk('delta', 'gpt-4'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 4, { timeout: 30000 });
await page.waitForSelector('[data-topo-brand-watermark]', { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const mark = document.querySelector('[data-topo-brand-watermark]');
  const vendorChips = document.querySelectorAll('[data-vendor-letter]');
  const spokes = document.querySelectorAll('[data-topo-spoke-angle]');
  return {
    present:        mark !== null,
    text:           mark?.textContent ?? null,
    x:              mark ? +mark.getAttribute('x') : null,
    y:              mark ? +mark.getAttribute('y') : null,
    opacity:        mark?.getAttribute('opacity') ?? null,
    fill:           mark ? window.getComputedStyle(mark).fill : null,
    vendorChipCount: vendorChips.length,
    spokeCount:     spokes.length,
  };
});
await browser.close();

const results = {
  watermark_present:           probe.present,
  watermark_text_is_brand:     probe.text === 'sleep2agi',
  watermark_x_is_16:           probe.x === 16,
  watermark_y_is_672:          probe.y === 672,
  watermark_opacity_0_4:       probe.opacity === '0.4',
  watermark_fill_set:          probe.fill != null && probe.fill !== '' && probe.fill !== 'none',
  r281_vendor_chip_absent_in_2_vendor: probe.vendorChipCount === 0,
  r280_spokes_absent:          probe.spokeCount === 0,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} brand watermark:`, JSON.stringify(results),
  '\n  text:', JSON.stringify(probe.text),
  '\n  (x,y):', `(${probe.x}, ${probe.y})`,
  '\n  opacity:', probe.opacity,
  '\n  fill:', probe.fill,
  '\n  vendor chips (expect 0):', probe.vendorChipCount,
  '\n  spokes (expect 0):',       probe.spokeCount);
process.exit(ok ? 0 : 1);
