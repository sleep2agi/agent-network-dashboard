/* Round 351 verification: Layout-toggle Ring|Grid buttons gain
 * hover-state letter-spacing (Tailwind hover:tracking-wide =
 * 0.025em). Extends the R344 (footer) / R345 (panel titles) /
 * R347 (zoom-level readout) hover-letter-spacing family to a
 * 4th surface — the chrome-strip Ring/Grid layout-toggle pair.
 *
 * Pure-CSS approach: no new React state. transition-colors
 * className dropped in favour of an inline transition spec
 * that bundles bg/color (150ms ease) + letter-spacing (200ms
 * ease-out) so the tracking-wide hover doesn't snap. Grid
 * button additionally keeps border-color in the transition
 * list (R268 theme-ease).
 *
 * Contract (cyber):
 *   - Rest: both buttons computed letter-spacing === 'normal' (0).
 *   - Hover Ring: computed letter-spacing === '0.4px' (0.025em ×
 *     ~14-16 base font; we'll accept any value > 0.1px).
 *   - Hover Grid: same.
 *   - Inline transition on both contains 'letter-spacing'.
 *   - Pre-R351 invariants: data-topo-chrome-layout attrs intact,
 *     R268 border-color transition still present on Grid.
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
  await route.fulfill({ response: r, json: { ...b, sessions: [ mk('a'), mk('b'), mk('c') ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-chrome-layout="ring"]', { timeout: 15000 });
await page.waitForSelector('[data-topo-chrome-layout="grid"]', { timeout: 5000 });
await page.waitForTimeout(300);

const restProbe = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-chrome-layout="ring"]');
  const g = document.querySelector('[data-topo-chrome-layout="grid"]');
  const rcs = r ? getComputedStyle(r) : null;
  const gcs = g ? getComputedStyle(g) : null;
  return {
    ringLs:     rcs?.letterSpacing ?? null,
    ringTrans:  rcs?.transition ?? null,
    gridLs:     gcs?.letterSpacing ?? null,
    gridTrans:  gcs?.transition ?? null,
  };
});

// Hover Ring button.
await page.hover('[data-topo-chrome-layout="ring"]');
await page.waitForTimeout(300);
const ringHover = await page.evaluate(() => {
  const r = document.querySelector('[data-topo-chrome-layout="ring"]');
  return { ls: r ? getComputedStyle(r).letterSpacing : null };
});

// Move to Grid button.
await page.hover('[data-topo-chrome-layout="grid"]');
await page.waitForTimeout(300);
const gridHover = await page.evaluate(() => {
  const g = document.querySelector('[data-topo-chrome-layout="grid"]');
  return { ls: g ? getComputedStyle(g).letterSpacing : null };
});

await browser.close();

const isRestLs = (v) => v === 'normal' || v === '0px' || v === '0' || v === null;
const isHoverLs = (v) => {
  // tracking-wide = 0.025em. At base 14-16px font, that's ~0.35-0.4px.
  if (!v || v === 'normal') return false;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0.2 && n < 1.0;
};
const hasTrans = (s, prop) =>
  new RegExp(`${prop}\\s+\\d*\\.?\\d*s|${prop}\\s+\\d+ms`, 'i').test(s || '');

const results = {
  rest_ring_ls_zero:    isRestLs(restProbe.ringLs),
  rest_grid_ls_zero:    isRestLs(restProbe.gridLs),
  ring_trans_has_ls:    hasTrans(restProbe.ringTrans, 'letter-spacing'),
  grid_trans_has_ls:    hasTrans(restProbe.gridTrans, 'letter-spacing'),
  grid_trans_has_bcol:  hasTrans(restProbe.gridTrans, 'border-color'),  // R268
  hover_ring_tracked:   isHoverLs(ringHover.ls),
  hover_grid_tracked:   isHoverLs(gridHover.ls),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} layout-toggle hover tracking-wide:`, JSON.stringify(results),
  '\n  rest:       ', restProbe,
  '\n  hover ring: ', ringHover,
  '\n  hover grid: ', gridHover);
process.exit(ok ? 0 : 1);
