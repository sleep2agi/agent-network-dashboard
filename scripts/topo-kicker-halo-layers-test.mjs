/* Round 685 — kicker "Network Topology" extends from 2 hover axes
 * (R555 tracking-spread + color lift) to also include multi-layer
 * halo paint axis. Closes title-block trio 3/3 (logo R683 + H2 R684
 * + kicker R685). CSS descendant rule targets the kicker via data
 * attr; 2+4px stride at currentColor (kicker scale = text-xs 12px).
 *
 * Source assertions:
 *   - globals.css has cluster-hover descendant rule for kicker with
 *     2 drop-shadow layers (2+4px)
 *   - globals.css has transition rule on kicker including 'filter 200ms'
 *   - TopoGraph.tsx kicker has data-topo-section-kicker-halo-layers="2"
 *
 * Runtime assertions:
 *   - kicker element present
 *   - halo-layers attr = "2"
 *   - kicker text = "Network Topology"
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-topo-section-kicker]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const kicker = document.querySelector('[data-topo-section-kicker]');
  return {
    present:     !!kicker,
    halo_layers: kicker?.getAttribute('data-topo-section-kicker-halo-layers'),
    text:        kicker?.textContent,
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const cssSrc = readFileSync('/home/vansin/agent-network-dashboard/app/globals.css', 'utf8');

const cssHoverRule  = /\[data-topo-section-titleblock-group\]:hover \[data-topo-section-kicker\]\s*\{[\s\S]*?drop-shadow\(0 0 2px currentColor\)[\s\S]*?drop-shadow\(0 0 4px currentColor\)/.test(cssSrc);
const cssTransition = /\[data-topo-section-kicker\]\s*\{[\s\S]*?transition:[\s\S]*?filter 200ms/.test(cssSrc);
const tsxHaloAttr   = /data-topo-section-kicker-halo-layers="2"/.test(tsxSrc);

const results = {
  kicker_present:      runtimeState.present,
  runtime_halo_layers: runtimeState.halo_layers === '2',
  runtime_text:        runtimeState.text === 'Network Topology',
  css_hover_rule:      cssHoverRule,
  css_transition:      cssTransition,
  tsx_halo_attr:       tsxHaloAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R685 kicker multi-layer halo (closes title-block trio 3/3):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`);
process.exit(ok ? 0 : 1);
