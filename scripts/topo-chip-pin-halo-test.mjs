/* Round 689 — working + online chip halo gates extend from hover-only
 * to ALSO fire on pinned state. Pinned chips become "permanently lit"
 * until unpinned, telegraphing the active filter more strongly.
 * Coherent with R664 status filter pin pill halo — R689 closes the
 * symmetry by lighting the SOURCE chip too while pin holds.
 *
 * Source assertions:
 *   - working chip filter gate includes `pinnedStatus === 'working'`
 *     in OR-chain with hoveredStatus === 'working'
 *   - online chip filter gate includes `pinnedStatus === 'idle'`
 *     in OR-chain with hover gate
 *   - halo-layers attrs reflect the extended gate logic
 *
 * Runtime assertions:
 *   - working + online chips render
 *   - rest halo-layers='0' on both (no hover, no pin)
 *   - data-pin-mirror attr matches pin state (existing — sanity check)
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
    working_halo:    working?.getAttribute('data-working-chip-halo-layers'),
    online_halo:     online?.getAttribute('data-online-chip-halo-layers'),
    working_pin:    working?.getAttribute('data-pin-mirror'),
    online_pin:     online?.getAttribute('data-pin-mirror'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWorkingGate = /\(hoveredStatus === 'working' \|\| pinnedStatus === 'working'\) && workingCount > 0/.test(src);
const sourceOnlineGate  = /\(\(hoveredStatus === 'working' \|\| hoveredStatus === 'idle'\) \|\| pinnedStatus === 'idle'\) && onlineNodes\.length > 0/.test(src);

const results = {
  rest_working_layers_0:  runtimeState.working_halo === '0',
  rest_online_layers_0:   runtimeState.online_halo === '0',
  rest_working_not_pinned: runtimeState.working_pin === 'false',
  rest_online_not_pinned:  runtimeState.online_pin === 'false',
  source_working_gate:    sourceWorkingGate,
  source_online_gate:     sourceOnlineGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R689 chip pin-gated halo (extends working+online filter gates to fire on pin):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
