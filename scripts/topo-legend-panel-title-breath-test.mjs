/* Round 701 — legend panel title at-rest SVG opacity breath, sibling
 * to R700 recent-panel-title breath. Closes the panel-pair breath
 * symmetry — both panel titles now share the 8s cadence.
 *
 * Source assertions:
 *   - TopoGraph.tsx has data-legend-panel-title-breath="..." attr
 *   - TopoGraph.tsx <animate> with values "0.78;1;0.78" dur="8s" inside legend title
 *
 * Runtime assertions:
 *   - legend title element present
 *   - data-legend-panel-title-breath='8s' at rest (!pinnedStatus)
 *   - <animate> child element present at rest with dur="8s"
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
await page.waitForSelector('[data-legend-panel-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const title = document.querySelector('[data-legend-panel-title]');
  if (!title) return null;
  const animate = title.querySelector('animate[attributeName="opacity"]');
  return {
    title_present: true,
    breath_attr: title.getAttribute('data-legend-panel-title-breath'),
    active_attr: title.getAttribute('data-legend-panel-title-active'),
    animate_present: !!animate,
    animate_dur: animate?.getAttribute('dur'),
    animate_values: animate?.getAttribute('values'),
    animate_repeat: animate?.getAttribute('repeatCount'),
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const tsxBreathAttr = /data-legend-panel-title-breath=\{!reducedMotion && !pinnedStatus \? '8s' : 'off'\}/.test(tsxSrc);
// Look for the second animate element after legend (R700 has one for recent, R701 has the same line for legend)
const allAnimates = tsxSrc.match(/<animate attributeName="opacity" values="0\.78;1;0\.78" dur="8s" repeatCount="indefinite" \/>/g) || [];
const tsxAnimateCount = allAnimates.length;

const results = {
  title_present:           !!runtimeState?.title_present,
  rest_breath_8s:          runtimeState?.breath_attr === '8s',
  rest_not_active:         runtimeState?.active_attr === 'false',
  animate_child_present:   runtimeState?.animate_present === true,
  animate_dur_8s:          runtimeState?.animate_dur === '8s',
  animate_values_correct:  runtimeState?.animate_values === '0.78;1;0.78',
  animate_repeat_indef:    runtimeState?.animate_repeat === 'indefinite',
  tsx_breath_attr:         tsxBreathAttr,
  tsx_animate_count_2:     tsxAnimateCount === 2,  // R700 + R701
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R701 legend-panel-title at-rest SVG breath (panel-pair breath symmetry closed):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)} animate_count: ${tsxAnimateCount}`);
process.exit(ok ? 0 : 1);
