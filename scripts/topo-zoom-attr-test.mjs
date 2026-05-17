/* Round 487 verification: root svg surfaces `data-topo-zoom`
 * numeric attr reflecting current view.zoom. Extends the R469/
 * R471 root-svg state surface set to 10 attrs.
 *
 * Contract:
 *   - default zoom (1.0): data-topo-zoom='1.00'
 *   - localStorage-seed zoom=1.6: data-topo-zoom='1.60'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(viewZoom) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  await ctx.addInitScript((arg) => {
    try {
      localStorage.setItem('anet-theme', 'cyber');
      localStorage.setItem('anet-topo-layout', 'ring');
      if (arg.zoom !== 1.0) {
        localStorage.setItem('anet-topo-view', JSON.stringify({ zoom: arg.zoom, x: 0, y: 0 }));
      } else {
        localStorage.removeItem('anet-topo-view');
      }
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, { zoom: viewZoom });
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
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('svg[data-topo-zoom]', { timeout: 15000 });
  await page.waitForTimeout(2800); // wait for localStorage-restore useEffect
  const attr = await page.evaluate(() =>
    document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-zoom')
  );
  await browser.close();
  return attr;
}

const defaultZoom = await probe(1.0);
const seededZoom = await probe(1.6);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceAttr = /data-topo-zoom=\{view\.zoom\.toFixed\(2\)\}/.test(src);

const results = {
  default_zoom_attr_present: defaultZoom !== null,
  default_zoom_value:        defaultZoom === '1.00',
  seeded_zoom_attr_present:  seededZoom !== null,
  seeded_zoom_value:         seededZoom === '1.60',
  source_attr_wired:         sourceAttr,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg data-topo-zoom attr:`, JSON.stringify(results),
  '\n  default:', defaultZoom, '/ seeded:', seededZoom);
process.exit(ok ? 0 : 1);
