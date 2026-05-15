/* Round 135 verification: both overlay panels (recent-signal +
 * legend) drop-shadow boosts on mouseenter, restores on leave.
 * Mirrors R18's KPI-card hover-elevation from the Overview page.
 *
 * Why both panels: each panel chrome already hosts interactive
 * rows (R56/R116 recent rows, R55/R61 legend rows) and footer
 * nav (R133). Hover-lift signals "this whole panel is alive"
 * without misleading users that the panel itself is clickable —
 * the underlying click affordances are still the rows + footer.
 *
 * State transitions tested:
 *   1. Neither panel hovered → both data-topo-panel-hovered="false",
 *      both rect filters = baseline (2px/6px blur)
 *   2. Hover recent → that panel hovered=true, filter boosted
 *      (4px/12px blur); legend still baseline
 *   3. Leave recent (move far away) → recent restored
 *   4. Hover legend → legend hovered=true, filter boosted
 *   5. Leave legend → legend restored
 *
 * Filter inline-string detection: the boosted variant carries the
 * `4px 12px` magic numbers in its drop-shadow argument.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1400, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try { localStorage.setItem('anet-theme', 'cyber'); sessionStorage.setItem('anet_v3_auth', '1'); } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'), mk('beta', 'idle'), mk('gamma', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-panel="recent"]', { timeout: 10000 });
await page.waitForTimeout(400);

const inspect = () => page.evaluate(() => {
  const get = (key) => {
    const g = document.querySelector(`[data-topo-panel="${key}"]`);
    const rect = g?.querySelector('rect[data-topo-panel-elevation]');
    return {
      hovered: g?.getAttribute('data-topo-panel-hovered'),
      filter: (rect?.getAttribute('style') || ''),
    };
  };
  return { recent: get('recent'), legend: get('legend') };
});

// State 1 — neither hovered
const s1 = await inspect();

// State 2 — hover recent
await page.locator('[data-topo-panel="recent"]').hover();
await page.waitForTimeout(300);
const s2 = await inspect();

// State 3 — leave recent (move far away from both panels)
await page.mouse.move(700, 350);
await page.waitForTimeout(300);
const s3 = await inspect();

// State 4 — hover legend
await page.locator('[data-topo-panel="legend"]').hover();
await page.waitForTimeout(300);
const s4 = await inspect();

// State 5 — leave legend
await page.mouse.move(500, 350);
await page.waitForTimeout(300);
const s5 = await inspect();

await browser.close();

const isBoosted = (style) => /4px\s+12px/.test(style);
const isBase    = (style) => /2px\s+6px/.test(style) && !/4px\s+12px/.test(style);

const results = {
  s1_recent_notHovered: s1.recent.hovered === 'false',
  s1_legend_notHovered: s1.legend.hovered === 'false',
  s1_recent_baseShadow: isBase(s1.recent.filter),
  s1_legend_baseShadow: isBase(s1.legend.filter),

  s2_recent_hovered:    s2.recent.hovered === 'true',
  s2_recent_boosted:    isBoosted(s2.recent.filter),
  s2_legend_stillBase:  s2.legend.hovered === 'false' && isBase(s2.legend.filter),

  s3_recent_restored:   s3.recent.hovered === 'false' && isBase(s3.recent.filter),

  s4_legend_hovered:    s4.legend.hovered === 'true',
  s4_legend_boosted:    isBoosted(s4.legend.filter),
  s4_recent_stillBase:  s4.recent.hovered === 'false' && isBase(s4.recent.filter),

  s5_legend_restored:   s5.legend.hovered === 'false' && isBase(s5.legend.filter),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} panel hover elevation:`, JSON.stringify(results),
  `\n  s1=`, s1, `\n  s2=`, s2, `\n  s3=`, s3, `\n  s4=`, s4, `\n  s5=`, s5);
process.exit(ok ? 0 : 1);
