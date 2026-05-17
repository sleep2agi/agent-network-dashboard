/* Round 464 verification: group-box parent rect rx 14 → 16 on
 * isPinned — geometric softening at the corner radius. Pin
 * signature on the outer container now spans 7 axes (R63 fill +
 * R142 filter + R432 ls + R444 count fw + R457 parent fw + codex
 * p.125 opacity + R464 rx).
 *
 * Contract:
 *   - every <rect data-group-box-rx> renders with rx='14' at rest
 *   - clicking the group-label hitbox flips that group's rx to '16'
 *   - sibling groups stay '14'
 *   - transition list (R461) extends to include `rx 200ms`
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
await page.waitForSelector('[data-group-box-rx]', { timeout: 15000 });
await page.waitForTimeout(400);

const readAll = () => page.evaluate(() => {
  const boxes = [...document.querySelectorAll('[data-group-box-rx]')];
  return boxes.map(b => {
    const parentG = b.closest('g[data-group]');
    return {
      key: parentG ? parentG.getAttribute('data-group') : null,
      rx_attr: b.getAttribute('data-group-box-rx'),
      rx_live: b.getAttribute('rx'),
    };
  });
});

const rest = await readAll();
const firstKey = rest[0]?.key;

let pinned = null;
if (firstKey) {
  // click hitbox to pin
  const hit = await page.$(`[data-group-label-hit="${firstKey}"]`);
  if (hit) {
    await hit.click();
    await page.waitForTimeout(300);
    pinned = await readAll();
  }
}

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceRxConditional = /rx=\{isPinned \? '16' : '14'\}/.test(src);
const sourceTransitionHasRx = /rx 200ms ease-out/.test(src);

await browser.close();

const restCountGe2  = rest.length >= 2;
const restAll14     = rest.every(r => r.rx_attr === '14' && r.rx_live === '14');
const pinnedTarget  = pinned?.find(r => r.key === firstKey);
const pinTargetIs16 = pinnedTarget?.rx_attr === '16' && pinnedTarget?.rx_live === '16';
const pinSiblingsRest = pinned ? pinned.filter(r => r.key !== firstKey).every(r => r.rx_attr === '14') : false;

const results = {
  rest_count_ge_2:           restCountGe2,
  rest_all_rx_14:            restAll14,
  pinned_target_rx_16:       pinTargetIs16,
  pinned_siblings_rest:      pinSiblingsRest,
  source_rx_conditional:     sourceRxConditional,
  source_transition_has_rx:  sourceTransitionHasRx,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} group box rx pin 14→16:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  pinned target:', JSON.stringify(pinnedTarget));
process.exit(ok ? 0 : 1);
