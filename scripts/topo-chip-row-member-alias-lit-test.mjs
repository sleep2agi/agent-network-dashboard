/* Round 565 (50-round milestone) verification: chip-row chips
 * gain "lit" bg/border treatment when operator hovers a node
 * alias matching the chip's status tier. 7th anchor in the
 * inspection-overrides-encoding family.
 *
 * Mock: alpha·1 (working) + alpha·2 (idle) + alpha·3 (offline).
 * Hover alpha·1 → working chip lit (bg-green-500/15); hover
 * alpha·2 → online chip lit (bg-cyan-500/15).
 *
 * Test phases:
 *   1. rest: both chip bg's at /10 alpha (0.1); attrs 'false'
 *   2. hover alpha·1 (working) → working chip bg at /15 (0.15);
 *      attr 'true'; online chip stays at /10
 *   3. hover alpha·2 (idle) → online chip bg at /15; attr 'true';
 *      working stays at /10
 *   4. hover alpha·3 (offline) → neither chip lit
 *   5. source-side regex confirms wiring
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('anet-theme', 'cyber');
    localStorage.setItem('anet-topo-layout', 'ring');
    sessionStorage.setItem('anet_v3_auth', '1');
  } catch {}
});
await ctx.route('**/api/hub/status*', async (route) => {
  const r = await route.fetch();
  const b = await r.json();
  const nid = (b.sessions || [])[0]?.network_id || 'default';
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha·1', 'working'),
    mk('alpha·2', 'idle'),
    mk('alpha·3', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000 });
await page.waitForTimeout(500);

const probeChips = async () => {
  return page.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      // Tailwind v4 emits bg in oklab format: oklab(L A B / alpha)
      // Parse the trailing alpha to detect /10 vs /15.
      const m = (cs.backgroundColor || '').match(/\/\s*([0-9.]+)\s*\)/);
      return {
        bg: cs.backgroundColor,
        bgAlpha: m ? parseFloat(m[1]) : null,
      };
    };
    return {
      working: {
        ...probe('[data-working-chip]'),
        lit: document.querySelector('[data-working-chip-member-alias-lit]')
          ?.getAttribute('data-working-chip-member-alias-lit') === 'true',
      },
      online: {
        ...probe('[data-online-chip]'),
        lit: document.querySelector('[data-online-chip-member-alias-lit]')
          ?.getAttribute('data-online-chip-member-alias-lit') === 'true',
      },
    };
  });
};

const rest = await probeChips();

// Hover working node
await page.hover('g[data-node="alpha·1"]');
await page.waitForTimeout(400);
const hoverWorking = await probeChips();

// Move and hover idle node
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover('g[data-node="alpha·2"]');
await page.waitForTimeout(400);
const hoverIdle = await probeChips();

// Move and hover offline node
await page.mouse.move(0, 0);
await page.waitForTimeout(300);
await page.hover('g[data-node="alpha·3"]');
await page.waitForTimeout(400);
const hoverOffline = await probeChips();

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceTierKey = /const hoveredAliasTierKey: 'working' \| 'idle' \| 'offline' \| null/.test(src);
const sourceWorkingLit = /const isWorkingChipLit = hoveredAliasTierKey === 'working';/.test(src);
const sourceOnlineLit = /const isOnlineChipLit\s+= hoveredAliasTierKey === 'idle';/.test(src);
const sourceWorkingClass = /isWorkingChipLit \? 'bg-green-500\/15 border-green-500\/30' : 'bg-green-500\/10 border-green-500\/20'/.test(src);
const sourceOnlineClass = /isOnlineChipLit \? 'bg-cyan-500\/15 border-cyan-500\/30' : 'bg-cyan-500\/10 border-cyan-500\/20'/.test(src);
const sourceWorkingAttr = /data-working-chip-member-alias-lit=/.test(src);
const sourceOnlineAttr = /data-online-chip-member-alias-lit=/.test(src);

const closeAlpha = (a, target) => a !== null && Math.abs(a - target) < 0.005;

const results = {
  rest_working_alpha_10:        closeAlpha(rest.working.bgAlpha, 0.1),
  rest_online_alpha_10:         closeAlpha(rest.online.bgAlpha, 0.1),
  rest_working_lit_false:       rest.working.lit === false,
  rest_online_lit_false:        rest.online.lit === false,
  // hover working → working chip alpha lifts to 0.15
  hover_working_w_alpha_15:     closeAlpha(hoverWorking.working.bgAlpha, 0.15),
  hover_working_w_lit_true:     hoverWorking.working.lit === true,
  hover_working_o_alpha_10:     closeAlpha(hoverWorking.online.bgAlpha, 0.1),
  hover_working_o_lit_false:    hoverWorking.online.lit === false,
  // hover idle → online chip alpha lifts; working stays
  hover_idle_o_alpha_15:        closeAlpha(hoverIdle.online.bgAlpha, 0.15),
  hover_idle_o_lit_true:        hoverIdle.online.lit === true,
  hover_idle_w_alpha_10:        closeAlpha(hoverIdle.working.bgAlpha, 0.1),
  hover_idle_w_lit_false:       hoverIdle.working.lit === false,
  // hover offline → neither chip lit
  hover_offline_w_lit_false:    hoverOffline.working.lit === false,
  hover_offline_o_lit_false:    hoverOffline.online.lit === false,
  // Source
  source_tier_key:    sourceTierKey,
  source_working_lit: sourceWorkingLit,
  source_online_lit:  sourceOnlineLit,
  source_working_class: sourceWorkingClass,
  source_online_class:  sourceOnlineClass,
  source_working_attr: sourceWorkingAttr,
  source_online_attr:  sourceOnlineAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R565 chip-row chip member-alias-lit (7th anchor, 50-round milestone):`,
  JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover working node:', JSON.stringify(hoverWorking),
  '\n  hover idle node:', JSON.stringify(hoverIdle),
  '\n  hover offline node:', JSON.stringify(hoverOffline));
process.exit(ok ? 0 : 1);
