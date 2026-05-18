/* Round 687 — working + online chips extend from 4 hover axes (bg/
 * border swap + translate-y + active scale) to add multi-layer halo
 * paint axis. Per-tier tints — green-400 #4ade80 for working chip,
 * cyan-300 #67e8f9 for online chip — match the existing pinnedStatus
 * boxShadow inset rings. 2+4 stride, alpha 80/40. Sibling extension
 * to R686 active-links chip; closes chip-row left-side trio
 * (working + online + active-links) at halo-axis parity.
 *
 * Source assertions:
 *   - working chip filter: pal green-400 #4ade80 80/40 2+4 stride
 *   - online chip filter: pal cyan-300 #67e8f9 80/40 2+4 stride
 *   - both halo-layers attrs toggle '2' ↔ '0' on respective gates
 *
 * Runtime assertions:
 *   - both chips present
 *   - rest halo-layers='0' on both
 *   - mock sessions ensure both chips are interactive (workingCount + onlineNodes > 0)
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
    mk('a·1', 'working'),
    mk('a·2', 'idle'),
    mk('a·3', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-working-chip]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const working = document.querySelector('[data-working-chip]');
  const online  = document.querySelector('[data-online-chip]');
  return {
    working_present: !!working,
    online_present:  !!online,
    working_halo:    working?.getAttribute('data-working-chip-halo-layers'),
    online_halo:     online?.getAttribute('data-online-chip-halo-layers'),
    working_click:   working?.getAttribute('data-working-chip-clickable'),
    online_click:    online?.getAttribute('data-online-chip-clickable'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWorkingFilter = /filter: hoveredStatus === 'working' && workingCount > 0\s*\?\s*'drop-shadow\(0 0 2px #4ade8080\) drop-shadow\(0 0 4px #4ade8040\)'/.test(src);
const sourceOnlineFilter  = /filter: \(hoveredStatus === 'working' \|\| hoveredStatus === 'idle'\) && onlineNodes\.length > 0\s*\?\s*'drop-shadow\(0 0 2px #67e8f980\) drop-shadow\(0 0 4px #67e8f940\)'/.test(src);
const sourceWorkingAttr   = /data-working-chip-halo-layers=\{hoveredStatus === 'working' && workingCount > 0 \? '2' : '0'\}/.test(src);
const sourceOnlineAttr    = /data-online-chip-halo-layers=\{\(hoveredStatus === 'working' \|\| hoveredStatus === 'idle'\) && onlineNodes\.length > 0 \? '2' : '0'\}/.test(src);

const results = {
  working_present:        runtimeState.working_present,
  online_present:         runtimeState.online_present,
  rest_working_layers_0:  runtimeState.working_halo === '0',
  rest_online_layers_0:   runtimeState.online_halo === '0',
  working_interactive:    runtimeState.working_click === 'true',
  online_interactive:     runtimeState.online_click === 'true',
  source_working_filter:  sourceWorkingFilter,
  source_online_filter:   sourceOnlineFilter,
  source_working_attr:    sourceWorkingAttr,
  source_online_attr:     sourceOnlineAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R687 working+online chip multi-layer halo (closes chip-row left-side trio):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
