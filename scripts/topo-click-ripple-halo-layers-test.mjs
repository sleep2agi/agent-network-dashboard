/* Round 657 — click-ripple drop-shadow gains a SECOND outer layer
 * at 8px + 0x4c alpha (half R608 inner 0x99). 16th anchor in
 * multi-layer halo family (1st click-feedback anchor).
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
await page.waitForSelector('[data-node="a·1"]', { timeout: 15000 });
await page.waitForTimeout(500);

// rest: no ripple
const restRipple = await page.evaluate(() => !!document.querySelector('[data-click-ripple]'));

// click node → ripple mounts; poll to catch it before it self-cleans
await page.click('[data-node="a·1"]', { force: true });
let activeState = null;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(40);
  const s = await page.evaluate(() => {
    const el = document.querySelector('[data-click-ripple]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      layers: el.getAttribute('data-click-ripple-halo-layers'),
      filter: cs.filter,
    };
  });
  if (s) { activeState = s; break; }
}

await browser.close();

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceFilter = /filter: `drop-shadow\(0 0 4px \$\{clickRipple\.color\}99\) drop-shadow\(0 0 8px \$\{clickRipple\.color\}4c\)`/.test(src);
const sourceLayersAttr = /data-click-ripple-halo-layers="2"/.test(src);

const dropShadowCount = (activeState?.filter?.match(/drop-shadow/g) || []).length;

const results = {
  rest_no_ripple:          restRipple === false,
  active_present:          !!activeState,
  active_layers_2:         activeState?.layers === '2',
  active_two_dropshadows:  dropShadowCount === 2,
  source_filter:           sourceFilter,
  source_layers_attr:      sourceLayersAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R657 click-ripple multi-layer halo (1st click-feedback anchor):`,
  JSON.stringify(results, null, 2),
  `\n  active: ${JSON.stringify(activeState)}`);
process.exit(ok ? 0 : 1);
