/* Round 450 verification: minimap viewport rect rest opacity 0.9 →
 * 0.95. Closes half the alpha gap on the wayfinding indicator.
 *
 * Contract:
 *   - rest: viewport rect opacity '0.95'
 *   - hover the minimap container: viewport opacity '1' (R346 preserved)
 *   - strokeWidth invariants preserved (rest=1.5, hover=1.75)
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

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
  const mk = (alias, status) => ({
    alias, status, model: 'claude-opus-4', runtime: 'claude-code-cli',
    network_id: nid, project_dir: null,
    created_at: fresh, updated_at: fresh, last_seen_at: fresh,
  });
  // Need enough nodes for minimap to render — and a non-default view
  await route.fulfill({ response: r, json: { ...b, sessions: [
    mk('alpha', 'working'),
    mk('beta',  'idle'),
    mk('gamma', 'working'),
    mk('delta', 'idle'),
  ] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [] } }));
await ctx.route('**/api/hub/tasks*',    (r) => r.fulfill({ json: { tasks: [] } }));

const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' });

// Trigger a zoom to mount the minimap (R30 gate: minimap only renders on non-default view)
await page.waitForSelector('[data-topo-chrome-zoom-in]', { timeout: 15000 });
await page.click('[data-topo-chrome-zoom-in]');
await page.waitForTimeout(300);

await page.waitForSelector('[data-topo-minimap-viewport]', { timeout: 5000 });
await page.waitForTimeout(300);

const rest = await page.evaluate(() => {
  const v = document.querySelector('[data-topo-minimap-viewport]');
  return v ? {
    opacity: v.getAttribute('opacity'),
    sw:      v.getAttribute('stroke-width'),
    hover:   v.getAttribute('data-topo-minimap-viewport-hover'),
  } : null;
});

// Hover the minimap container
let hover = null;
const minimap = await page.$('[data-topo-minimap]');
if (minimap) {
  await minimap.hover({ force: true });
  await page.waitForTimeout(250);
  hover = await page.evaluate(() => {
    const v = document.querySelector('[data-topo-minimap-viewport]');
    return v ? {
      opacity: v.getAttribute('opacity'),
      sw:      v.getAttribute('stroke-width'),
      hover:   v.getAttribute('data-topo-minimap-viewport-hover'),
    } : null;
  });
}

const fileText = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceWired = /opacity=\{hoveredMinimap \? '1' : '0\.95'\}/.test(fileText);

await browser.close();

const results = {
  rest_mounted:           !!rest,
  rest_opacity_0_95:      rest?.opacity === '0.95',
  rest_sw_1_5:            rest?.sw === '1.5',
  rest_hover_false:       rest?.hover === 'false',
  hover_opacity_1:        hover?.opacity === '1',
  hover_sw_1_75:          hover?.sw === '1.75',
  hover_hover_true:       hover?.hover === 'true',
  source_wired:           sourceWired,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} minimap viewport rest opacity:`, JSON.stringify(results),
  '\n  rest:', JSON.stringify(rest),
  '\n  hover:', JSON.stringify(hover));
process.exit(ok ? 0 : 1);
