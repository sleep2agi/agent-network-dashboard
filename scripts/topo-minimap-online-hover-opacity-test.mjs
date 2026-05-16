/* Round 421 verification: minimap online dot opacity 0.95 → 1.0 on
 * minimap container hover. Sibling to R346 viewport rect tween.
 * Live-fleet anchors brighten when user hovers the minimap.
 *
 * Contract:
 *   - Minimap mounts on non-default view → zoom-in twice
 *   - Rest state: online dot opacity '0.95' (R392 invariant)
 *   - Hover state (page.hover on minimap container):
 *     * online dot opacity '1' + data '1'
 *     * R346 viewport strokeWidth '1.75'
 *   - Offline dot stays at R372 '0.6' in both states
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();

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
  await route.fulfill({ response: r, json: { ...b, sessions: [
    { alias: 'alpha', status: 'idle',    model: 'claude-opus-4', runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: fresh, updated_at: fresh, last_seen_at: fresh },
    { alias: 'ghost', status: 'offline', model: 'claude-opus-4', runtime: 'claude-code-cli', network_id: nid, project_dir: null, created_at: stale, updated_at: stale, last_seen_at: stale },
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('g[data-node]', { timeout: 15000 });
await page.waitForTimeout(300);

await page.click('[data-topo-chrome-zoom-in]');
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForSelector('[data-topo-minimap-dot]', { timeout: 5000 });
await page.waitForTimeout(400);

const restProbe = await page.evaluate(() => {
  const dots = Array.from(document.querySelectorAll('[data-topo-minimap-dot]'));
  const on  = dots.find((d) => d.getAttribute('data-topo-minimap-dot-online') === 'true');
  const off = dots.find((d) => d.getAttribute('data-topo-minimap-dot-online') === 'false');
  return {
    online:  on  ? { opacity: on.getAttribute('opacity'),  data: on.getAttribute('data-topo-minimap-dot-opacity')  } : null,
    offline: off ? { opacity: off.getAttribute('opacity'), data: off.getAttribute('data-topo-minimap-dot-opacity') } : null,
  };
});

await page.hover('[data-topo-minimap]');
await page.waitForTimeout(400);

const hoverProbe = await page.evaluate(() => {
  const dots = Array.from(document.querySelectorAll('[data-topo-minimap-dot]'));
  const on  = dots.find((d) => d.getAttribute('data-topo-minimap-dot-online') === 'true');
  const off = dots.find((d) => d.getAttribute('data-topo-minimap-dot-online') === 'false');
  const view = document.querySelector('[data-topo-minimap-viewport]');
  return {
    online:  on  ? { opacity: on.getAttribute('opacity'),  data: on.getAttribute('data-topo-minimap-dot-opacity')  } : null,
    offline: off ? { opacity: off.getAttribute('opacity'), data: off.getAttribute('data-topo-minimap-dot-opacity') } : null,
    viewportSw: view?.getAttribute('stroke-width') ?? null,
  };
});

await browser.close();

const results = {
  // Rest state (R392 baseline)
  rest_online_0_95:     restProbe.online?.opacity === '0.95',
  rest_online_data_0_95: restProbe.online?.data === '0.95',
  rest_offline_0_6:     restProbe.offline?.opacity === '0.6',
  // Hover state (R421 lift)
  hover_online_1:       hoverProbe.online?.opacity === '1',
  hover_online_data_1:  hoverProbe.online?.data === '1',
  // R372 offline invariant: stays at 0.6 in both states
  hover_offline_0_6:    hoverProbe.offline?.opacity === '0.6',
  // R346 viewport lift on hover (invariant)
  hover_viewport_sw_1_75: hoverProbe.viewportSw === '1.75',
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap online dot hover opacity 0.95 → 1.0:`, JSON.stringify(results),
  '\n  rest: ', restProbe,
  '\n  hover:', hoverProbe);
process.exit(ok ? 0 : 1);
