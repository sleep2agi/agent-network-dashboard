/* Round 713 — panel-pair dual-axis breath. Both recent + legend panel
 * titles gain a 2nd SVG <animate> for font-size at the same 8s cadence
 * as their R700/R701 opacity breath. Closes panel-pair dual-axis
 * symmetry under the primary-identity dual-axis rule (R711 H2 +
 * R712 watermark established the pattern; R713 closes the panel pair).
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
  await route.fulfill({ response: r, json: { ...b, sessions: [mk('a·1'), mk('a·2'), mk('a·3')] } });
});
await ctx.route('**/api/hub/messages*', (r) => r.fulfill({ json: { messages: [
  { id: 'm1', from_alias: 'a·1', to_alias: 'a·2', kind: 'message', content: 'p', network_id: 'default', created_at: fresh },
] } }));
await ctx.route('**/api/hub/tasks*', (r) => r.fulfill({ json: { tasks: [] } }));
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-legend-panel-title]', { timeout: 15000, state: 'attached' });
await page.waitForTimeout(300);

const runtimeState = await page.evaluate(() => {
  const recent = document.querySelector('[data-recent-panel-title]');
  const legend = document.querySelector('[data-legend-panel-title]');
  const probe = (text) => {
    if (!text) return null;
    const opAnim = text.querySelector('animate[attributeName="opacity"]');
    const fsAnim = text.querySelector('animate[attributeName="font-size"]');
    return {
      opacity_dur: opAnim?.getAttribute('dur'),
      opacity_values: opAnim?.getAttribute('values'),
      fontsize_present: !!fsAnim,
      fontsize_dur: fsAnim?.getAttribute('dur'),
      fontsize_values: fsAnim?.getAttribute('values'),
      fontsize_repeat: fsAnim?.getAttribute('repeatCount'),
      breath_axis_2: text.getAttribute(text === recent ? 'data-recent-panel-title-breath-axis-2' : 'data-legend-panel-title-breath-axis-2'),
    };
  };
  return {
    recent: probe(recent),
    legend: probe(legend),
  };
});

await browser.close();

const tsxSrc = readFileSync('/home/vansin/agent-network-dashboard/app/components/TopoGraph.tsx', 'utf8');
const fontSizeAnimateCount = (tsxSrc.match(/<animate attributeName="font-size" values="11\.96;12\.04;11\.96" dur="8s" repeatCount="indefinite" \/>/g) || []).length;
const tsxRecentAxis2 = /data-recent-panel-title-breath-axis-2=\{!reducedMotion && !activeEdgeKey \? 'font-size' : 'off'\}/.test(tsxSrc);
const tsxLegendAxis2 = /data-legend-panel-title-breath-axis-2=\{!reducedMotion && !pinnedStatus \? 'font-size' : 'off'\}/.test(tsxSrc);

const results = {
  recent_opacity_kept:        runtimeState?.recent?.opacity_values === '0.78;1;0.78',
  recent_opacity_dur_8s:      runtimeState?.recent?.opacity_dur === '8s',
  recent_fontsize_present:    runtimeState?.recent?.fontsize_present === true,
  recent_fontsize_dur_8s:     runtimeState?.recent?.fontsize_dur === '8s',
  recent_fontsize_values:     runtimeState?.recent?.fontsize_values === '11.96;12.04;11.96',
  recent_axis_2_attr:         runtimeState?.recent?.breath_axis_2 === 'font-size',
  legend_opacity_kept:        runtimeState?.legend?.opacity_values === '0.78;1;0.78',
  legend_fontsize_present:    runtimeState?.legend?.fontsize_present === true,
  legend_fontsize_dur_8s:     runtimeState?.legend?.fontsize_dur === '8s',
  legend_fontsize_values:     runtimeState?.legend?.fontsize_values === '11.96;12.04;11.96',
  legend_axis_2_attr:         runtimeState?.legend?.breath_axis_2 === 'font-size',
  tsx_count_2:                fontSizeAnimateCount === 2,
  tsx_recent_axis_2:          tsxRecentAxis2,
  tsx_legend_axis_2:          tsxLegendAxis2,
};
const ok = Object.values(results).every(Boolean);
console.log(`${ok ? '✅' : '❌'} R713 panel-pair dual-axis breath (opacity + font-size at 8s, panel-pair symmetric closure):`,
  JSON.stringify(results, null, 2),
  `\n  runtime: ${JSON.stringify(runtimeState)}`,
  `\n  tsx font-size animate count: ${fontSizeAnimateCount}`);
process.exit(ok ? 0 : 1);
