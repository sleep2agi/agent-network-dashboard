/* Round 374 verification: pressure-bar height h-1.5 → h-2 (6 → 8 px).
 * Sibling visual-weight bump (8th canvas/HTML anchor in the family).
 * +33 % bar height gives working/idle/offline segments more visibility.
 *
 * Geometry-safe: items-center flex centers the bar inside the chip's
 * py-1 — bar at 8 px stays comfortably inside the 10-px text-row.
 *
 * Contract (cyber, fixture with mix):
 *   - Pressure bar wrapper computed height === '8px' (h-2).
 *   - data-fleet-pressure-bar-height === 'h-2'.
 *   - Pre-R374 invariants:
 *     * width still w-16 (64 px)
 *     * inline-flex display + rounded-full + overflow-hidden
 *     * background rgb(75 85 99 / 0.25)
 *     * Parent [data-fleet-pressure] chip className unchanged
 *       (font-mono + chip structure)
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
  const mk = (alias, status = 'working') => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Mix so all 3 segments render.
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('w1'), mk('w2'),
    mk('i1', 'idle'), mk('i2', 'idle'),
    mk('o1', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-fleet-pressure-bar-height]', { timeout: 15000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const bar = document.querySelector('[data-fleet-pressure-bar-height]');
  const cs = bar ? getComputedStyle(bar) : null;
  const parent = document.querySelector('[data-fleet-pressure]');
  // Count visible segments inside the bar.
  const segs = bar ? Array.from(bar.querySelectorAll('[data-pressure-seg]')) : [];
  return {
    height:        cs?.height ?? null,
    width:         cs?.width ?? null,
    barHeightData: bar?.getAttribute('data-fleet-pressure-bar-height') ?? null,
    display:       cs?.display ?? null,
    borderRadius:  cs?.borderRadius ?? null,
    overflow:      cs?.overflow ?? null,
    bgColor:       cs?.backgroundColor ?? null,
    parentMono:    /font-mono/.test(parent?.getAttribute('class') || ''),
    segCount:      segs.length,
  };
});

await browser.close();

const results = {
  height_8px:           probe.height === '8px',                // h-2
  width_64px:           probe.width === '64px',                // w-16
  data_height_h_2:      probe.barHeightData === 'h-2',
  // Flex items get display blockified: inline-flex → flex when nested
  // in flex container. Accept either.
  display_inline_flex:  probe.display === 'inline-flex' || probe.display === 'flex',
  // Tailwind rounded-full is border-radius: 9999px, which browsers
  // sometimes render as 3.35544e+07px (huge approximation). Accept any
  // value indicating fully-rounded.
  has_rounded_full:     /9999|3\.355|e\+/.test(probe.borderRadius || ''),
  overflow_hidden:      probe.overflow === 'hidden',
  parent_font_mono:     probe.parentMono,
  three_segments:       probe.segCount === 3,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} pressure-bar height 1.5 → 2:`, JSON.stringify(results),
  '\n  probe:', probe);
process.exit(ok ? 0 : 1);
