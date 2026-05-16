/* Round 430 verification: hub-spoke opacity hover lift on
 * hoveredAlias === session.alias. Idle 0.50 → 0.70; active 0.80 → 0.95.
 *
 * Contract:
 *   - rest: all idle spokes report data-topo-hub-spoke-opacity '0.5'
 *     and data-topo-hub-spoke-hovered 'false'
 *   - hover one node: that node's spoke opacity '0.7' (idle case)
 *     + data-topo-hub-spoke-hovered 'true'
 *   - siblings stay at rest 0.5
 *   - active state branch tested via source-file (deterministic
 *     active fixture is harder — flow link timing). The runtime DOM
 *     check covers the idle path; source-file probe covers both
 *     branches symmetrically.
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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-topo-hub-spoke-active]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const paths = [...document.querySelectorAll('[data-topo-hub-spoke-active]')];
  // The spokes are keyed by `hub-${alias}`. We can't easily key them
  // back by alias from data attrs, so we just snapshot their attrs.
  return paths.map((p, i) => ({
    idx:        i,
    active:     p.getAttribute('data-topo-hub-spoke-active'),
    hovered:    p.getAttribute('data-topo-hub-spoke-hovered'),
    opacity:    p.getAttribute('data-topo-hub-spoke-opacity'),
    opacity_a:  p.getAttribute('opacity'),
  }));
});

const rest = await readAll();

// Hover the first node group
const firstAlias = await page.evaluate(() => {
  const t = document.querySelector('[data-node-alias-text]');
  return t?.getAttribute('data-node-alias-text');
});
let hover = null;
if (firstAlias) {
  const box = await page.evaluate((alias) => {
    const t = document.querySelector(`[data-node-alias-text="${alias}"]`);
    if (!t) return null;
    const node = t.closest('[data-node]');
    const target = node || t;
    const b = target.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, firstAlias);
  if (box) {
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(300);
    hover = await readAll();
    await page.mouse.move(0, 0);
  }
}

// Source-file probe
const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceIsActive = /isActiveSpoke\s*\?\s*\(isHoveredSpoke\s*\?\s*0\.95\s*:\s*0\.80\)\s*:\s*\(isHoveredSpoke\s*\?\s*0\.70\s*:\s*0\.50\)/.test(fileText);
const sourceIsHovered = /const isHoveredSpoke = !reducedMotion && hoveredAlias === session\.alias/.test(fileText);

await browser.close();

const restAllIdle    = rest.length > 0 && rest.every(r => r.active === 'false');
const restAllOpacity = rest.every(r => r.opacity === '0.5');
const restNoneHover  = rest.every(r => r.hovered === 'false');
const hoveredCount   = hover ? hover.filter(s => s.hovered === 'true').length : -1;
// idle-state hover lift: opacity 0.7
const hoveredEntry   = hover?.find(s => s.hovered === 'true');
const hoveredOpacity = hoveredEntry?.opacity === '0.7';
const otherHoverNone = hover ? hover.filter(s => s.hovered === 'false').every(s => s.opacity === '0.5') : false;

const results = {
  rest_spoke_count_ge_3:    rest.length >= 3,
  rest_all_idle:            restAllIdle,
  rest_all_opacity_0_5:     restAllOpacity,
  rest_no_hover:            restNoneHover,
  hover_exactly_one_match:  hoveredCount === 1,
  hover_target_opacity_0_7: hoveredOpacity,
  hover_others_stay_rest:   otherHoverNone,
  source_three_tier_wired:  sourceIsActive,
  source_isHoveredSpoke_def: sourceIsHovered,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hub-spoke hover opacity:`, JSON.stringify(results),
  '\n  rest sample:', JSON.stringify(rest[0]),
  '\n  hover target:', JSON.stringify(hoveredEntry));
process.exit(ok ? 0 : 1);
