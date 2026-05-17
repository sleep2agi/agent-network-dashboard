/* Round 518 verification: legend-row COUNT digit gains the same 3-tier
 * hover-letter-spacing tween R433 added to the LABEL — symmetric row
 * hover gesture. Also lifts transition list 150 → 200ms closing R475
 * panel-row cadence at the count surface.
 *
 * Test phases:
 *   1. rest:  letter-spacing 0px, attr='0px', transition includes '200ms'
 *   2. hover: letter-spacing 0.25px, attr='0.25px'
 *   3. source-side regex confirms 3-tier wiring + 200ms cadence
 *
 * Pin tier (0.5px) requires real click + filter-pin localStorage —
 * skip and rely on source-regex for the pinned tier.
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
    mk('a·1', 'idle'),
    mk('a·2', 'idle'),
    mk('b·1', 'working'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-count]', { timeout: 15000 });
await page.waitForTimeout(800);

// Pick the 'online' row's count (it'll have count > 0 so we see typography)
const targetSel = '[data-legend-count="idle"]';

// Phase 1: rest
const rest = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrLS:        el.getAttribute('data-legend-count-letter-spacing'),
    attrTrans:     el.getAttribute('data-legend-count-transition'),
    letterSpacing: cs.letterSpacing,
    transition:    cs.transition,
  };
}, targetSel);

// Phase 2: hover the row's hitbox (the parent g — but row hover is keyed
// on hoveredStatus which is set by mouseEnter on the row-hitbox rect.
// Easier: hover the LABEL text (also part of the row) and observe count.
await page.hover('[data-legend-row-label="idle"]');
await page.waitForTimeout(350);
const hover = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    attrLS:        el.getAttribute('data-legend-count-letter-spacing'),
    letterSpacing: cs.letterSpacing,
  };
}, targetSel);

await browser.close();

// Phase 3: source regex — verifies all 3 tiers + 200ms cadence
const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWiredLS =
  /letterSpacing: isPinned \? '0\.5px' :\s*hoveredStatus === row\.key \? '0\.25px' : '0px',/.test(src);
const sourceWiredAttr =
  /data-legend-count-letter-spacing=\{isPinned \? '0\.5px' : hoveredStatus === row\.key \? '0\.25px' : '0px'\}/.test(src);
const sourceWiredCadence =
  /transition: 'opacity 200ms ease-out, fill 200ms ease-out, font-weight 200ms ease-out, letter-spacing 200ms ease-out',/.test(src);

const results = {
  rest_attr_0:               rest?.attrLS === '0px',
  rest_attr_transition_200:  rest?.attrTrans === '200ms',
  rest_letter_spacing_0:     rest?.letterSpacing === '0px' || rest?.letterSpacing === 'normal',
  rest_transition_200ms:     /(200ms|0\.2s)/.test(rest?.transition || ''),
  hover_attr_025:            hover?.attrLS === '0.25px',
  hover_letter_spacing_025:  hover?.letterSpacing === '0.25px',
  source_3_tier_ls:          sourceWiredLS,
  source_attr_3_tier:        sourceWiredAttr,
  source_200ms_cadence:      sourceWiredCadence,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R518 legend-count 3-tier letter-spacing + 200ms:`, JSON.stringify(results, null, 2),
  '\n  rest:', JSON.stringify(rest), '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
