/* Round 77 verification: hovering the "N active links" header chip
 * boosts every flow edge to 1.5× the baseline opacity simultaneously.
 * Mouseleave restores. Composes with R49 / R50 — single-edge hover
 * still wins over chip hover (the priority is edge > node > chip).
 *
 *  - 3 flow edges; baseline opacity ~0.28 each.
 *  - Hover the active-links chip → all 3 jump to ~0.42 (1.5×).
 *  - Mouse-leave → all 3 return to ~0.28.
 *  - Hover an individual edge while chip is also hovered → R50 wins,
 *    edge gets 2.0×, others drop to 0.35×.  (We just check chip-hover
 *    here; the interaction with edge hover is documented in R50 tests.)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
    sessionStorage.removeItem('anet-topo-pinned-status');
    sessionStorage.removeItem('anet-topo-pinned-group');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const sessions = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].map(a => ({
    alias: a, status: 'idle', network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  }));
  await route.fulfill({ response: r, json: { ...b, sessions } });
});
const now = new Date().toISOString();
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [
  { from_alias: 'alpha',   to_alias: 'beta',  content: 'm', created_at: now },
  { from_alias: 'gamma',   to_alias: 'delta', content: 'm', created_at: now },
  { from_alias: 'epsilon', to_alias: 'zeta',  content: 'm', created_at: now },
] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 6, { timeout: 30000 });
await page.waitForTimeout(600);

const readEdgeOpacities = () => page.evaluate(() => {
  const out = {};
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  for (const g of svg.querySelectorAll(':scope > g > g')) {
    const t = g.querySelector('path[data-edge-hitbox] title');
    if (!t) continue;
    const route = (t.textContent || '').split('\n')[0];
    const base = [...g.querySelectorAll(':scope > path')].find(
      p => !p.hasAttribute('data-edge-hitbox') && p.hasAttribute('marker-end')
    );
    if (base) out[route] = +base.getAttribute('opacity');
  }
  return out;
});

const before = await readEdgeOpacities();

// Hover the active-links chip.
const chipExists = await page.locator('[data-active-links-chip]').count();
if (chipExists === 0) { console.log('❌ active-links chip not rendered'); process.exit(1); }
await page.locator('[data-active-links-chip]').hover();
await page.waitForTimeout(300);
const onHover = await readEdgeOpacities();

// Mouse-leave.
await page.mouse.move(10, 10);
await page.waitForTimeout(300);
const afterLeave = await readEdgeOpacities();

await browser.close();

const ratio = (after, before) => after / before;
const allAround = (rs, lo, hi) => rs.every(r => r > lo && r < hi);

const baseValues = Object.values(before);
const hoverValues = Object.values(onHover);
const leaveValues = Object.values(afterLeave);

const results = {
  baseline_equalAtBase:  allAround(baseValues, 0.25, 0.31),
  hover_allBoosted_15x:  allAround(hoverValues.map((v, i) => ratio(v, baseValues[i])), 1.4, 1.6),
  hover_absoluteRange:   allAround(hoverValues, 0.39, 0.46),  // 1.5 * (0.22..0.28) * fresh
  leave_restoreBaseline: allAround(leaveValues.map((v, i) => Math.abs(v - baseValues[i])), -0.01, 0.02),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} active-links chip hover:`, JSON.stringify(results),
  `\n  before=`,  before,
  `\n  onHover=`, onHover,
  `\n  afterLeave=`, afterLeave);
process.exit(ok ? 0 : 1);
