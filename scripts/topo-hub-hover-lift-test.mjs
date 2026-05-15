/* Round 177 verification: hub hover ring picks up the
 * lift-on-hover gesture (r=14 → r=17), 7th surface in the
 * hover-elevation family.
 *
 * Pre-R177 R115 hover ring at r=14 faded opacity 0→0.7 on
 * hover but stayed static size. R177 adds r=14→17 on hover
 * — same vocabulary R164 uses for edge badges (r=9→10.5).
 *
 * Test:
 *   1. Mock 3 sessions in ring layout
 *   2. Probe [data-topo-hub-hover-ring] idle: r=14, opacity=0
 *   3. Hover the hub <g>
 *   4. Re-probe: r=17, opacity=0.7 (cyber)
 *   5. Mouse away
 *   6. Re-probe: r=14, opacity=0
 *   7. Transition style includes both opacity AND r
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
    localStorage.setItem('anet-topo-layout', 'ring');
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
await page.waitForSelector('[data-topo-hub-hover-ring]', { timeout: 10000 });
await page.waitForTimeout(400);

const probe = () => page.evaluate(() => {
  const el = document.querySelector('[data-topo-hub-hover-ring]');
  if (!el) return null;
  return {
    r:           parseFloat(el.getAttribute('r') || ''),
    opacity:     parseFloat(el.getAttribute('opacity') || ''),
    radiusAttr:  parseFloat(el.getAttribute('data-topo-hub-hover-ring-radius') || ''),
    transition:  el.style.transition || getComputedStyle(el).transition,
  };
});

const idle = await probe();

// Hover the hub
await page.locator('[data-topo-hub]').hover();
await page.waitForTimeout(250);
const hovered = await probe();

// Move cursor away
await page.mouse.move(10, 10);
await page.waitForTimeout(250);
const idleAgain = await probe();

await browser.close();

const results = {
  ring_found:                idle !== null,
  idle_r_14:                 idle && Math.abs(idle.r - 14) < 0.01,
  idle_opacity_0:            idle && idle.opacity === 0,
  idle_radius_attr_14:       idle && idle.radiusAttr === 14,

  hover_r_17:                hovered && Math.abs(hovered.r - 17) < 0.01,
  hover_opacity_0p7:         hovered && Math.abs(hovered.opacity - 0.7) < 0.01,
  hover_radius_attr_17:      hovered && hovered.radiusAttr === 17,

  idle_again_r_14:           idleAgain && Math.abs(idleAgain.r - 14) < 0.01,
  idle_again_opacity_0:      idleAgain && idleAgain.opacity === 0,

  transition_has_opacity:    (idle?.transition || '').match(/opacity\s+(180ms|0\.18s)/),
  transition_has_r:          (idle?.transition || '').match(/(^|\s|,)\s*r\s+(180ms|0\.18s)/),
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub hover lift:`, JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v]) => [k, !!v]))),
  `\n  idle    =`, idle,
  `\n  hovered =`, hovered,
  `\n  idle2   =`, idleAgain);
process.exit(ok ? 0 : 1);
