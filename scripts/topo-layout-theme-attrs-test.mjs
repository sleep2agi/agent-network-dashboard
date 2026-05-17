/* Round 471 verification: root svg surfaces 2 canvas-level mode
 * attrs (data-topo-layout + data-topo-theme). Completes the
 * R462/R466/R467/R469 root-svg state surface set; canvas root
 * now carries 9 cross-cutting attrs.
 *
 * Contract:
 *   - cyber theme + grid layout fixture →
 *     data-topo-layout='grid' + data-topo-theme='cyber'
 *   - source-file conditional wired
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const TOKEN = JSON.parse(readFileSync('/home/vansin/.anet/config.json', 'utf8')).token;
const fresh = new Date(Date.now() - 60 * 1000).toISOString();

async function probe(theme, layout) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.addCookies([{ name: 'anet_dashboard_session', value: `v3:${TOKEN}`, domain: '127.0.0.1', path: '/' }]);
  // Playwright addInitScript takes only ONE arg — pass {theme, layout}
  // as a struct instead of two positional params.
  await ctx.addInitScript((arg) => {
    try {
      localStorage.setItem('anet-theme', arg.theme);
      localStorage.setItem('anet-topo-layout', arg.layout);
      sessionStorage.setItem('anet_v3_auth', '1');
    } catch {}
  }, { theme, layout });
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
  await page.waitForSelector('svg[data-topo-layout]', { timeout: 15000 });
  // Give React extra time to hydrate + run useEffects that restore
  // layout/theme from localStorage (live probe showed ~2500ms).
  await page.waitForTimeout(2800);
  // Wait for the localStorage-restore useEffect (line 592-620) to
  // run + React to commit the state — layout starts at 'ring' default
  // and flips to the localStorage value on mount. The data-attr won't
  // reflect the saved value until after the first effect tick. Live
  // probe showed ~2500ms is enough.
  await page.waitForFunction(
    (expected) => document.querySelector('svg[viewBox="0 0 1000 680"]')?.getAttribute('data-topo-layout') === expected,
    layout,
    { timeout: 10000 },
  ).catch(() => {});
  const attrs = await page.evaluate(() => {
    const svg = document.querySelector('svg[viewBox="0 0 1000 680"]');
    return {
      layout: svg?.getAttribute('data-topo-layout'),
      theme:  svg?.getAttribute('data-topo-theme'),
    };
  });
  await browser.close();
  return attrs;
}

const cyberGrid = await probe('cyber', 'grid');
const lightRing = await probe('light', 'ring');

const src = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const sourceLayout = /data-topo-layout=\{layout\}/.test(src);
const sourceTheme  = /data-topo-theme=\{isLight \? 'light' : 'cyber'\}/.test(src);

const results = {
  cyber_grid_layout: cyberGrid.layout === 'grid',
  cyber_grid_theme:  cyberGrid.theme === 'cyber',
  light_ring_layout: lightRing.layout === 'ring',
  light_ring_theme:  lightRing.theme === 'light',
  source_layout:     sourceLayout,
  source_theme:      sourceTheme,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} svg layout+theme attrs:`, JSON.stringify(results),
  '\n  cyber+grid:', JSON.stringify(cyberGrid),
  '\n  light+ring:', JSON.stringify(lightRing));
process.exit(ok ? 0 : 1);
