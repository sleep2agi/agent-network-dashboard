/* Round 469 verification: root svg surfaces 4 numeric fleet-split
 * attrs (online/working/offline/flow counts). Pre-R469 these
 * numbers only lived in the aria-label text; tests + external UI
 * had to parse the string. R469 makes them queryable directly.
 *
 * Contract:
 *   - svg carries data-topo-online-count / working-count /
 *     offline-count / flow-count
 *   - values are integer-shaped strings
 *   - fixture 3 working + 2 idle + 1 offline → online=5 working=3
 *     offline=1 flow=0
 *   - source-file conditional wired
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
    mk('a·1', 'working'), mk('a·2', 'working'), mk('a·3', 'working'),
    mk('b·1', 'idle'),    mk('b·2', 'idle'),
    mk('c·1', 'offline'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('svg[data-topo-online-count]', { timeout: 15000 });
await page.waitForTimeout(400);

const attrs = await page.evaluate(() => {
  const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
  return {
    online:  svg?.getAttribute('data-topo-online-count'),
    working: svg?.getAttribute('data-topo-working-count'),
    offline: svg?.getAttribute('data-topo-offline-count'),
    flow:    svg?.getAttribute('data-topo-flow-count'),
  };
});

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceOnline  = /data-topo-online-count=\{onlineNodes\.length\}/.test(src);
const sourceWorking = /data-topo-working-count=\{workingCount\}/.test(src);
const sourceOffline = /data-topo-offline-count=\{offlineNodes\.length\}/.test(src);
const sourceFlow    = /data-topo-flow-count=\{flowLinks\.length\}/.test(src);

await browser.close();

const intShape = (v) => typeof v === 'string' && /^\d+$/.test(v);

const results = {
  online_present:    intShape(attrs.online),
  working_present:   intShape(attrs.working),
  offline_present:   intShape(attrs.offline),
  flow_present:      intShape(attrs.flow),
  online_is_5:       attrs.online === '5',
  working_is_3:      attrs.working === '3',
  offline_is_1:      attrs.offline === '1',
  flow_is_0:         attrs.flow === '0',
  source_4_attrs:    sourceOnline && sourceWorking && sourceOffline && sourceFlow,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg fleet-count attrs:`, JSON.stringify(results),
  '\n  attrs:', JSON.stringify(attrs));
process.exit(ok ? 0 : 1);
