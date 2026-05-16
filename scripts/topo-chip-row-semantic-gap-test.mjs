/* Round 260 verification: chip-row semantic gap — Layout toggle (control)
 * separated from display chips by an extra 4px (mr-1 stacks on parent
 * gap-2 → effective 12px).
 *
 * Pre-R260 the header chip-row rendered all 8 children at uniform
 * gap-2 (8px):
 *
 *   [Ring|Grid] [N working] [N online] [pressure ▮▮] [A:3 ?:1] [N active links] [filter…] [live · Ns]
 *               8           8          8             8         8                 8         8
 *
 * Spatial signal said "8 separate things" — but semantically only the
 * Layout toggle is a CONTROL (changes layout mode); everything that
 * follows is READ-ONLY display chrome. R260 widens the gap before the
 * first display chip via mr-1 on the Layout toggle wrapper:
 *
 *   [Ring|Grid]    12px    [N working] 8 [N online] 8 [pressure ▮▮] …
 *               ↑
 *               control → display boundary
 *
 * Classic law-of-proximity polish — same pattern R255 applied to the
 * bottom-right chrome strip (fleet vs view).
 *
 * Test scope:
 *   1. Layout toggle present + tagged with data-topo-chrome-layout-trailer.
 *   2. Gap from Layout toggle's right edge to working chip's left edge
 *      is ≥ 11px (target 12px, allow 1px sub-pixel slop).
 *   3. Adjacent display chips' gap stays ~8px (working → online ∈ [6,10]).
 *   4. Vertical center alignment preserved between Layout toggle and
 *      the working chip (Δ ≤ 1px).
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
await page.waitForSelector('[data-topo-chrome-layout-trailer]', { timeout: 10000 });
await page.waitForSelector('[data-working-chip]',               { timeout: 10000 });
await page.waitForSelector('[data-online-chip]',                { timeout: 10000 });
await page.waitForTimeout(300);

const probe = await page.evaluate(() => {
  const trailer = document.querySelector('[data-topo-chrome-layout-trailer]');
  const working = document.querySelector('[data-working-chip]');
  const online  = document.querySelector('[data-online-chip]');
  const r = (el) => el ? el.getBoundingClientRect() : null;
  return {
    trailer: r(trailer),
    working: r(working),
    online:  r(online),
  };
});
await browser.close();

const gapToggleToWorking = (probe.trailer && probe.working) ? probe.working.left - probe.trailer.right : null;
const gapWorkingToOnline = (probe.working && probe.online)  ? probe.online.left  - probe.working.right : null;
const yCenterDelta = (probe.trailer && probe.working)
  ? Math.abs((probe.trailer.top + probe.trailer.height / 2) - (probe.working.top + probe.working.height / 2))
  : null;

const results = {
  trailer_present:               probe.trailer !== null,
  working_present:               probe.working !== null,
  online_present:                probe.online  !== null,
  toggle_to_working_gap_widened: gapToggleToWorking != null && gapToggleToWorking >= 11,
  working_to_online_gap_unchanged: gapWorkingToOnline != null && gapWorkingToOnline >= 6 && gapWorkingToOnline <= 10,
  y_center_aligned:              yCenterDelta != null && yCenterDelta <= 1,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} chip-row semantic gap:`, JSON.stringify(results),
  '\n  gaps: toggle→working =', gapToggleToWorking, 'working→online =', gapWorkingToOnline,
  '\n  yCenterΔ:', yCenterDelta);
process.exit(ok ? 0 : 1);
