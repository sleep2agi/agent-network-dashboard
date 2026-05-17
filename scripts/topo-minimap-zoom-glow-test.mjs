/* Round 481 verification: minimap viewport rect gains filter:
 * drop-shadow glow when view.zoom > 1.5. 6th anchor in the
 * drop-shadow visual-polish family — first ZOOM-STATE gate.
 *
 * Contract:
 *   - default zoom (1.0): data-topo-minimap-viewport-glow='false'
 *     AND computed filter === 'none'
 *   - zoomed in (1.8x): glow='true' + computed filter starts with
 *     'drop-shadow' using pal.legendAccent @ 0x80
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
      // Seed view state — zoom non-default forces the minimap to
      // mount and applies the test-targeted zoom value.
      localStorage.setItem('anet-topo-view', JSON.stringify({ zoom: arg.zoom, x: 0, y: 0 }));
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
      mk('a·1', 'working'), mk('a·2', 'idle'),
    ] } });
  });
  await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
  await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-topo-minimap-viewport-glow]', { timeout: 15000 });
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const r = document.querySelector('[data-topo-minimap-viewport-glow]');
    if (!r) return null;
    const cs = getComputedStyle(r);
    return {
      glow:   r.getAttribute('data-topo-minimap-viewport-glow'),
      filter: cs.filter,
    };
  });
  await browser.close();
  return result;
}

// Test BOTH branches: zoom=1.8 (glow on) and zoom=1.2 (glow off)
const zoomed = await probe(1.8);
const subThreshold = await probe(1.2);

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceGlowAttr  = /data-topo-minimap-viewport-glow=\{view\.zoom > 1\.5/.test(src);
const sourceDropShadow = /drop-shadow\(0 0 2px \$\{pal\.legendAccent\}80\)/.test(src);
const sourceFilterTween = /filter 200ms ease-out/.test(src);

const results = {
  zoomed_glow_true:     zoomed?.glow === 'true',
  zoomed_filter_drop:   zoomed && /drop-shadow/.test(zoomed.filter),
  sub_glow_false:       subThreshold?.glow === 'false',
  sub_filter_none:      subThreshold?.filter === 'none',
  source_glow_attr:     sourceGlowAttr,
  source_drop_shadow:   sourceDropShadow,
  source_filter_tween:  sourceFilterTween,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap zoom-state drop-shadow:`, JSON.stringify(results),
  '\n  zoomed=1.8:', JSON.stringify(zoomed),
  '\n  sub=1.2:', JSON.stringify(subThreshold));
process.exit(ok ? 0 : 1);
