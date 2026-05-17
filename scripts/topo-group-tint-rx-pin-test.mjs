/* Round 465 verification: hitbox tint rect rx 4 → 5 on
 * pinnedGroup match — mirror R464 (parent group-box rx 14 → 16
 * on isPinned) at the hitbox tier. Pre-R465 the inner hitbox
 * stayed at fixed rx=4 (codex p.125) while the outer container
 * gained pin-tier rx softening; R465 echoes the locked posture
 * at the smaller rect scale.
 *
 * Contract:
 *   - every <rect data-group-label-tint-rx> reports rx='4' at rest
 *   - clicking the hitbox flips that group's rx to '5'
 *   - sibling stays '4'
 *   - transition list (R460) extends to include rx 200ms
 *   - data-group-label-tint-geom-transition='x,width,rx'
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
    localStorage.setItem('anet-topo-layout', 'grid');
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
    mk('beta·1',  'working'),
    mk('beta·2',  'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-group-label-tint-rx]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const tints = [...document.querySelectorAll('[data-group-label-tint-rx]')];
  return tints.map(t => {
    const parentG = t.closest('g[data-group]');
    return {
      key: parentG ? parentG.getAttribute('data-group') : null,
      rx_attr: t.getAttribute('data-group-label-tint-rx'),
      rx_live: t.getAttribute('rx'),
      geom:    t.getAttribute('data-group-label-tint-geom-transition'),
    };
  });
});

const rest = await readAll();
const firstKey = rest[0]?.key;

let pinned = null;
if (firstKey) {
  const hit = await page.$(`[data-group-label-hit="${firstKey}"]`);
  if (hit) {
    await hit.click();
    await page.waitForTimeout(300);
    pinned = await readAll();
  }
}

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRxConditional   = /rx=\{pinnedGroup === box\.key \? '5' : '4'\}/.test(src);
const sourceGeomXWidthRx    = /data-group-label-tint-geom-transition="x,width,rx"/.test(src);

await browser.close();

const restCountGe2 = rest.length >= 2;
const restAllRx4   = rest.every(r => r.rx_attr === '4' && r.rx_live === '4');
const restGeomXWR  = rest.every(r => r.geom === 'x,width,rx');
const pinnedTarget = pinned?.find(r => r.key === firstKey);
const pinTargetRx5 = pinnedTarget?.rx_attr === '5' && pinnedTarget?.rx_live === '5';
const pinSiblings  = pinned ? pinned.filter(r => r.key !== firstKey).every(r => r.rx_attr === '4') : false;

const results = {
  rest_count_ge_2:         restCountGe2,
  rest_all_rx_4:           restAllRx4,
  rest_geom_attr_xwrx:     restGeomXWR,
  pinned_target_rx_5:      pinTargetRx5,
  pinned_siblings_rest:    pinSiblings,
  source_rx_conditional:   sourceRxConditional,
  source_geom_attr_xwrx:   sourceGeomXWidthRx,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} hitbox tint rx pin 4→5:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedTarget));
process.exit(ok ? 0 : 1);
