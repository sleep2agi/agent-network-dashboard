/* Round 691 — dense plain-text alias halo gate extends from hover-only
 * (R680) to (hover || chat-target). Closes dense-mode + chat-target
 * signaling parity at the per-node label scope — joins R616/R617/R645
 * chat-target-gated brightness family.
 *
 * Source assertions:
 *   - dense alias halo-layers attr: (hoveredAlias || chatAlias) gate
 *   - dense alias filter: same OR-gate at status.primary tint 2+4
 *
 * Runtime assertions:
 *   - dense fleet renders (≥17 nodes → triggers dense fallback)
 *   - rest halo-layers='0' on all (no hover, no chat)
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
  const mk = (alias) => ({
    alias, status: 'idle', model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // 18 nodes → dense fallback (>16)
  await route.fulfill({ response: r, json: { ...b, sessions: Array.from({ length: 18 }, (_, i) => mk(`a·${i + 1}`)) } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-node-dense-alias-text]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const labels = Array.from(document.querySelectorAll('[data-node-dense-alias-text]'));
  return {
    count: labels.length,
    all_layers_zero: labels.every(el => el.getAttribute('data-node-dense-alias-text-halo-layers') === '0'),
  };
});

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAttrGate   = /data-node-dense-alias-text-halo-layers=\{\(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\) \? '2' : '0'\}/.test(src);
const sourceFilterGate = /filter: \(hoveredAlias === session\.alias \|\| chatAlias === session\.alias\)\s*\?\s*`drop-shadow\(0 0 2px \$\{status\.primary\}80\) drop-shadow\(0 0 4px \$\{status\.primary\}40\)`/.test(src);

const results = {
  dense_labels_present:  runtimeState.count >= 10,
  rest_all_layers_zero:  runtimeState.all_layers_zero,
  source_attr_gate:      sourceAttrGate,
  source_filter_gate:    sourceFilterGate,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R691 dense alias chat-target-gated halo (closes dense-mode chat signaling):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${runtimeState.count} dense labels rendered`);
process.exit(ok ? 0 : 1);
