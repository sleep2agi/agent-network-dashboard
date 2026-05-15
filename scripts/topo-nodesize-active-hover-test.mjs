/* Round 179 verification: nodeSize S/M/L active button picks up
 * hover:bg-cyan-500/20, closing the inconsistency with R163
 * layout-toggle and R178 fullscreen which already ship the
 * cyan-500/20 hover step on the active variant.
 *
 * Three active-cyan chrome surfaces now share the same gesture:
 *   R163 Ring/Grid layout toggle (chip-row)
 *   R178 Fullscreen button (chrome BR)
 *   R179 nodeSize S/M/L (chrome BR)              ← this round
 *
 * Test:
 *   1. Default state: M is active (default nodeScale=0.84)
 *   2. Active 'M' button:
 *        className includes 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/20'
 *   3. Inactive 'S' button:
 *        className includes 'hover:bg-white/5'
 *        className does NOT include 'bg-cyan-500/15'
 *   4. Click 'S' → S becomes active
 *   5. S's className now has cyan + cyan-500/20 hover, M doesn't
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const browser = await chromium.launch({ headless: true });

const ctx = await browser.newContext({ viewport: { width: 1500, height: 1500 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    sessionStorage.setItem('anet_v3_auth', '1');
    localStorage.removeItem('anet-topo-nodescale');
  } catch {}
});

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias) => ({
    alias, status: 'working', model: 'claude-opus-4', runtime: 'cli-claude-code',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('alpha'), mk('beta'), mk('gamma')] } });
});
await ctx.route('**/api/hub/messages*', (route) => route.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*', (route) => route.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('g[data-node]').length === 3, { timeout: 30000 });
await page.waitForSelector('[data-topo-chrome-nodesize="M"]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const grab = (sel) => {
    const el = document.querySelector(sel);
    return el ? {
      className: el.getAttribute('class') || '',
      active:    el.getAttribute('data-topo-chrome-nodesize-active'),
    } : null;
  };
  return {
    S: grab('[data-topo-chrome-nodesize="S"]'),
    M: grab('[data-topo-chrome-nodesize="M"]'),
    L: grab('[data-topo-chrome-nodesize="L"]'),
  };
});

const initial = await probe();

// Click S → S becomes active
await page.locator('[data-topo-chrome-nodesize="S"]').click();
await page.waitForTimeout(450); // past R171 crossfade window
const afterS = await probe();

await browser.close();

const results = {
  // Initial: M default-active
  M_initial_active:           initial.M?.active === 'true',
  M_initial_has_cyan_bg:      initial.M?.className.includes('bg-cyan-500/15'),
  M_initial_has_cyan_text:    initial.M?.className.includes('text-cyan-300'),
  M_initial_has_cyan_hover:   initial.M?.className.includes('hover:bg-cyan-500/20'),

  S_initial_inactive:         initial.S?.active === 'false',
  S_initial_no_cyan_bg:       !initial.S?.className.includes('bg-cyan-500/15'),
  S_initial_has_white_hover:  initial.S?.className.includes('hover:bg-white/5'),
  S_initial_no_cyan_hover:    !initial.S?.className.includes('hover:bg-cyan-500/20'),

  // After click S: S active, M inactive
  S_after_click_active:       afterS.S?.active === 'true',
  S_after_has_cyan_bg:        afterS.S?.className.includes('bg-cyan-500/15'),
  S_after_has_cyan_hover:     afterS.S?.className.includes('hover:bg-cyan-500/20'),
  S_after_no_white_hover:     !afterS.S?.className.includes('hover:bg-white/5'),

  M_after_inactive:           afterS.M?.active === 'false',
  M_after_no_cyan_bg:         !afterS.M?.className.includes('bg-cyan-500/15'),
  M_after_no_cyan_hover:      !afterS.M?.className.includes('hover:bg-cyan-500/20'),
  M_after_has_white_hover:    afterS.M?.className.includes('hover:bg-white/5'),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} nodesize active hover:`, JSON.stringify(results),
  `\n  initial =`, initial,
  `\n  afterS  =`, afterS);
process.exit(ok ? 0 : 1);
