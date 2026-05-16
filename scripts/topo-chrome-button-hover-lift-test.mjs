/* Round 400 verification (milestone): chrome reset + fullscreen
 * buttons gain hover translateY(-1px) lift. Closes the hover-lift
 * gesture across every standalone interactive HTML element in
 * TopoGraph. Segmented controls (zoom/-+, nodeSize S/M/L,
 * Layout Ring/Grid) intentionally stay planted to preserve the
 * unified-strip appearance.
 *
 * Contract:
 *   - Reset button:
 *     * data-topo-chrome-reset-hover-lift === 'true'
 *     * className includes 'hover:-translate-y-px'
 *     * className includes 'transition-transform' + 'transform-gpu'
 *   - Fullscreen button:
 *     * data-topo-chrome-fullscreen-hover-lift === 'true'
 *     * className includes 'hover:-translate-y-px'
 *     * className includes 'transition-transform' + 'transform-gpu'
 *   - Pre-R400 invariants preserved:
 *     * R196 active:bg deeper press states
 *     * R288 strokeWidth=2.5 on chrome icons
 *     * R350 hover-rotate (reset) / R353 group-hover scale (fullscreen)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('alpha'), mk('beta') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-reset]', { timeout: 15000 });
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const reset = document.querySelector('[data-topo-chrome-reset]');
  const fs    = document.querySelector('[data-topo-chrome-fullscreen]');
  return {
    reset: reset ? {
      className: reset.className,
      lift:      reset.getAttribute('data-topo-chrome-reset-hover-lift'),
    } : null,
    fs: fs ? {
      className: fs.className,
      lift:      fs.getAttribute('data-topo-chrome-fullscreen-hover-lift'),
    } : null,
  };
});

await browser.close();

const rc = probe.reset?.className || '';
const fc = probe.fs?.className || '';
const results = {
  // Reset button R400 wiring
  reset_lift_true:                  probe.reset?.lift === 'true',
  reset_has_hover_translate:        rc.includes('hover:-translate-y-px'),
  reset_has_transition_transform:   rc.includes('transition-transform'),
  reset_has_transform_gpu:          rc.includes('transform-gpu'),
  reset_has_transition_colors:      rc.includes('transition-colors'),  // pre-R400 preserved
  reset_has_active_bg:              rc.includes('active:bg-white/10'),  // R196 preserved
  reset_has_rounded_md:             rc.includes('rounded-md'),
  // Fullscreen button R400 wiring
  fs_lift_true:                     probe.fs?.lift === 'true',
  fs_has_hover_translate:           fc.includes('hover:-translate-y-px'),
  fs_has_transition_transform:      fc.includes('transition-transform'),
  fs_has_transform_gpu:             fc.includes('transform-gpu'),
  fs_has_transition_colors:         fc.includes('transition-colors'),
  fs_has_group:                     fc.includes('group'),  // R353 invariant
  fs_has_rounded_md:                fc.includes('rounded-md'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chrome reset + fullscreen hover lift translateY(-1px):`, JSON.stringify(results),
  '\n  resetClass:', rc,
  '\n  fsClass:   ', fc);
process.exit(ok ? 0 : 1);
